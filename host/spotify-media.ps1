# Target Spotify's Windows media session, never the system-wide current player.
function Wait-WXMedia($Operation,[Type]$ResultType) {
 $method=[System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name.StartsWith('IAsyncOperation') -and $_.GetParameters()[0].ParameterType.GetGenericArguments().Count -eq 1}|Select-Object -First 1
 $task=$method.MakeGenericMethod($ResultType).Invoke($null,@($Operation))
 if(!$task.Wait(900)){throw 'Spotify did not respond in time; no retry'}
 return $task.Result
}
function Invoke-WXSpotify([string]$Encoded) {
 try {
  if(!$script:WXMediaLoaded){
   Add-Type -AssemblyName System.Runtime.WindowsRuntime
   $null=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
   $null=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]
   $null=[Windows.Media.MediaPlaybackAutoRepeatMode,Windows.Media,ContentType=WindowsRuntime]
   $script:WXMediaLoaded=$true
  }
  $q=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Encoded))|ConvertFrom-Json
  if(!$script:WXMediaManager){$script:WXMediaManager=Wait-WXMedia ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])}
  $sessions=@($script:WXMediaManager.GetSessions()|Where-Object{$_.SourceAppUserModelId -eq 'Spotify.exe' -or $_.SourceAppUserModelId -eq 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify'})
  if($sessions.Count -ne 1){throw 'Open one Spotify playback session'}
  $s=$sessions[0]
  $m=Wait-WXMedia ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $t=$s.GetTimelineProperties();$p=$s.GetPlaybackInfo();$c=$p.Controls
  $duration=$t.EndTime.TotalSeconds;$start=$t.StartTime.TotalSeconds
  $position=[double]$t.Position.TotalSeconds
  $seekMin=$start;$seekMax=$duration;$positionKnown=$true
  if($null -eq $t.MinSeekTime -or $null -eq $t.MaxSeekTime){$positionKnown=$false}else{
   $seekMin=[Math]::Max($start,$t.MinSeekTime.TotalSeconds);$seekMax=[Math]::Min($duration,$t.MaxSeekTime.TotalSeconds)
   if($seekMax -le $seekMin){$positionKnown=$false;$seekMin=$start;$seekMax=$duration}
  }
  # Windows reports Position as of LastUpdatedTime, not as of this read.
  if($p.PlaybackStatus.ToString() -eq 'Playing'){
   if($null -eq $p.PlaybackRate -or $null -eq $t.LastUpdatedTime){$positionKnown=$false}else{
    $rate=[double]$p.PlaybackRate;$age=([DateTimeOffset]::UtcNow-[DateTimeOffset]$t.LastUpdatedTime).TotalSeconds
    if([double]::IsNaN($rate) -or [double]::IsInfinity($rate) -or $age -lt -1 -or [DateTimeOffset]$t.LastUpdatedTime -lt [DateTimeOffset]'1970-01-01Z'){$positionKnown=$false}else{$position+=[Math]::Max(0,$age)*$rate}
   }
  }elseif($p.PlaybackStatus.ToString() -notin @('Paused','Stopped')){$positionKnown=$false}
  $position=[Math]::Max($seekMin,[Math]::Min($seekMax,$position))
  $identity=@($s.SourceAppUserModelId,$s.GetHashCode(),$m.Title,$m.Artist,$m.AlbumTitle,$start,$duration)|ConvertTo-Json -Compress
  $sha=[Security.Cryptography.SHA256]::Create()
  try{$context='track-'+([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($identity))).Replace('-','').ToLower())}finally{$sha.Dispose()}
  $actions=@()
  foreach($pair in @(@('transport.play','IsPlayEnabled'),@('transport.pause','IsPauseEnabled'),@('transport.stop','IsStopEnabled'),@('transport.toggle','IsPlayPauseToggleEnabled'),@('transport.previous','IsPreviousEnabled'),@('transport.next','IsNextEnabled'))){if($c.($pair[1])){$actions+=,$pair[0]}}
  if($c.IsRepeatEnabled -and $null -ne $p.AutoRepeatMode){$actions+='repeat.cycle'}
  $parameters=@(
   @{id='position';label='POSITION';type='float';value=$position;min=$seekMin;max=$seekMax;step=5;default=$seekMin;unit='s';available=([bool]$c.IsPlaybackPositionEnabled -and $positionKnown -and $seekMax -gt $seekMin)},
   @{id='shuffle';label='SHUFFLE';type='bool';value=($p.IsShuffleActive -eq $true);available=([bool]$c.IsShuffleEnabled -and $null -ne $p.IsShuffleActive)},
   @{id='repeat';label='REPEAT';type='int';value=[int]$p.AutoRepeatMode;min=0;max=2;step=1;default=0;unit='';available=([bool]$c.IsRepeatEnabled -and $null -ne $p.AutoRepeatMode)}
  )
  if($q.route -eq 'state'){return (@{ok=$true;contextId=$context;workspace='Spotify';playing=($p.PlaybackStatus.ToString() -eq 'Playing');parameters=$parameters;actions=$actions;title=$m.Title;artist=$m.Artist}|ConvertTo-Json -Depth 6 -Compress)}
  if($q.route -ne 'action'){throw 'Unknown media request'}
  $a=$q.action
  if($a.contextId -ne $context){throw 'Track changed; use the control again'}
  if([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -gt $q.deadlineUnixMs){throw 'Expired media action; no input sent'}
  if($a.verb -eq 'command'){
   if($actions -notcontains $a.command){throw 'Spotify does not support that command now'}
   $op=switch($a.command){
    'transport.play' {$s.TryPlayAsync()}
    'transport.pause' {$s.TryPauseAsync()}
    'transport.stop' {$s.TryStopAsync()}
    'transport.toggle' {$s.TryTogglePlayPauseAsync()}
    'transport.previous' {$s.TrySkipPreviousAsync()}
    'transport.next' {$s.TrySkipNextAsync()}
    'repeat.cycle' {$s.TryChangeAutoRepeatModeAsync([Windows.Media.MediaPlaybackAutoRepeatMode](([int]$p.AutoRepeatMode+1)%3))}
   }
  }else{
   $param=$parameters|Where-Object{$_.id -eq $a.parameter}
   if(!$param -or !$param.available){throw 'Spotify parameter unavailable'}
   if($a.parameter -eq 'shuffle' -and $a.verb -eq 'toggle'){$op=$s.TryChangeShuffleActiveAsync(-not $param.value)}
   elseif($a.parameter -in @('position','repeat') -and $a.verb -in @('turn','reset')){
    if($a.verb -eq 'reset'){$value=$param.default}else{
     if($a.mode -notin @('normal','fine','coarse') -or $a.detents -ne [Math]::Truncate($a.detents) -or [Math]::Abs($a.detents) -gt 320){throw 'Invalid media movement'}
     $step=if($a.parameter -eq 'repeat'){1}elseif($a.mode -eq 'fine'){1}elseif($a.mode -eq 'coarse'){30}else{5}
     $value=[Math]::Max($param.min,[Math]::Min($param.max,$param.value+$a.detents*$step))
    }
    if($a.parameter -eq 'position'){$op=$s.TryChangePlaybackPositionAsync([long]([Math]::Round($value*10000000)))}else{$op=$s.TryChangeAutoRepeatModeAsync([Windows.Media.MediaPlaybackAutoRepeatMode][int]$value)}
   }else{throw 'Unsupported media action'}
  }
  $ok=Wait-WXMedia $op ([bool])
  if(!$ok){throw 'Spotify refused the action'}
  return '{"ok":true}'
 }catch{return (@{ok=$false;error=$_.Exception.Message}|ConvertTo-Json -Compress)}
}
