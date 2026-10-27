$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../host/spotify-media.ps1')
# Exercise the actual dispatcher with a fake Windows session; no app access or input.
function Wait-WXMedia($Operation,[Type]$ResultType){return $Operation}
$script:writes=@()
$script:timeline=[pscustomobject]@{StartTime=[TimeSpan]::Zero;EndTime=[TimeSpan]::FromSeconds(200);Position=[TimeSpan]::FromSeconds(50);MinSeekTime=[TimeSpan]::Zero;MaxSeekTime=[TimeSpan]::FromSeconds(200);LastUpdatedTime=[DateTimeOffset]::UtcNow}
$script:properties=[pscustomobject]@{Title='One';Artist='Test';AlbumTitle='Fixture'}
$script:controls=[pscustomobject]@{IsPlayEnabled=$true;IsPauseEnabled=$true;IsStopEnabled=$false;IsPlayPauseToggleEnabled=$true;IsPreviousEnabled=$true;IsNextEnabled=$true;IsRepeatEnabled=$true;IsShuffleEnabled=$true;IsPlaybackPositionEnabled=$true}
$script:playback=[pscustomobject]@{Controls=$script:controls;AutoRepeatMode=0;IsShuffleActive=$false;PlaybackStatus='Paused';PlaybackRate=1}
$script:session=[pscustomobject]@{SourceAppUserModelId='Spotify.exe'}
$script:session|Add-Member ScriptMethod TryGetMediaPropertiesAsync {return $script:properties}
$script:session|Add-Member ScriptMethod GetTimelineProperties {return $script:timeline}
$script:session|Add-Member ScriptMethod GetPlaybackInfo {return $script:playback}
$script:session|Add-Member ScriptMethod TryChangePlaybackPositionAsync {param($v);$script:writes+=,@('seek',$v);return $true}
$script:session|Add-Member ScriptMethod TryChangeShuffleActiveAsync {param($v);$script:writes+=,@('shuffle',$v);return $true}
$script:session|Add-Member ScriptMethod TryChangeAutoRepeatModeAsync {param($v);$script:writes+=,@('repeat',[int]$v);return $true}
$script:session|Add-Member ScriptMethod TryPlayAsync {$script:writes+=,@('play');return $true}
$script:WXMediaManager=[pscustomobject]@{}
$script:WXMediaManager|Add-Member ScriptMethod GetSessions {return ,$script:session}
function Request($route,$action=$null,$expired=$false){
 $q=@{route=$route;action=$action;deadlineUnixMs=([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+$(if($expired){-1}else{1200}))}|ConvertTo-Json -Depth 5 -Compress
 Invoke-WXSpotify ([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($q)))|ConvertFrom-Json
}
function Check($condition,$name){if(!$condition){throw "FAIL $name"}}
$s=Request state
Check $s.ok 'state'
Check ($s.parameters[0].value -eq 50) 'position readback'
Check ($s.actions -notcontains 'transport.stop') 'unsupported stop omitted'
$ctx=$s.contextId
foreach($mode in @('fine','normal','coarse')){
 $x=Request action @{verb='turn';parameter='position';contextId=$ctx;mode=$mode;detents=2}
 Check $x.ok "seek $mode"
}
Check ($script:writes[0][1] -eq 520000000) 'fine seek 1s'
Check ($script:writes[1][1] -eq 600000000) 'normal seek 5s'
Check ($script:writes[2][1] -eq 1100000000) 'coarse seek 30s'
$before=$script:writes.Count
$x=Request action @{verb='command';command='transport.play';contextId=$ctx} $true
Check (!$x.ok -and $script:writes.Count -eq $before) 'expired writes rejected'
$script:properties.Title='Two'
$x=Request action @{verb='command';command='transport.play';contextId=$ctx}
Check (!$x.ok -and $script:writes.Count -eq $before) 'changed track rejected'
$ctx=(Request state).contextId
$x=Request action @{verb='command';command='transport.stop';contextId=$ctx}
Check (!$x.ok -and $script:writes.Count -eq $before) 'unsupported command rejected'
$x=Request action @{verb='toggle';parameter='shuffle';contextId=$ctx}
Check ($x.ok -and $script:writes[-1][0] -eq 'shuffle' -and $script:writes[-1][1]) 'shuffle true'
$x=Request action @{verb='reset';parameter='position';contextId=$ctx}
Check ($x.ok -and $script:writes[-1][1] -eq 0) 'position reset'
$x=Request action @{verb='command';command='repeat.cycle';contextId=$ctx}
Check ($x.ok -and $script:writes[-1][0] -eq 'repeat' -and $script:writes[-1][1] -eq 1) 'repeat cycle'
$script:playback.PlaybackStatus='Playing'
$script:timeline.LastUpdatedTime=[DateTimeOffset]::UtcNow.AddSeconds(-20)
$s=Request state
Check ($s.ok -and $s.parameters[0].value -ge 70 -and $s.parameters[0].value -lt 72) 'playing timestamp extrapolation'
$x=Request action @{verb='turn';parameter='position';contextId=$s.contextId;mode='normal';detents=1}
Check ($x.ok -and $script:writes[-1][1] -ge 750000000 -and $script:writes[-1][1] -lt 770000000) 'playing relative seek uses current position'
$script:playback.PlaybackRate=2
$s=Request state
Check ($s.parameters[0].value -ge 90 -and $s.parameters[0].value -lt 94) 'playback rate respected'
$script:timeline.MinSeekTime=[TimeSpan]::FromSeconds(40);$script:timeline.MaxSeekTime=[TimeSpan]::FromSeconds(80)
$s=Request state
Check ($s.parameters[0].value -eq 80 -and $s.parameters[0].min -eq 40 -and $s.parameters[0].max -eq 80) 'seek range clamp'
$x=Request action @{verb='reset';parameter='position';contextId=$s.contextId}
Check ($x.ok -and $script:writes[-1][1] -eq 400000000) 'reset within seek range'
$script:playback.PlaybackStatus='Paused'
Check ((Request state).parameters[0].value -eq 50) 'paused does not extrapolate'
$script:playback.PlaybackStatus='Playing';$script:timeline.LastUpdatedTime=$null
$before=$script:writes.Count;$s=Request state
Check (!$s.parameters[0].available) 'missing timestamp unavailable'
$x=Request action @{verb='turn';parameter='position';contextId=$s.contextId;mode='normal';detents=1}
Check (!$x.ok -and $script:writes.Count -eq $before) 'uncertain relative seek blocked'
$script:timeline.LastUpdatedTime=[DateTimeOffset]::UtcNow.AddMinutes(1)
Check (!(Request state).parameters[0].available) 'future timestamp unavailable'
$script:playback.PlaybackStatus='Paused';$script:timeline.MaxSeekTime=$null
Check (!(Request state).parameters[0].available) 'unknown seek range unavailable'
$script:session.SourceAppUserModelId='OtherPlayer.exe'
Check (!(Request state).ok) 'no other player fallback'
'PASS Spotify actual PowerShell dispatch: state, capability guards, fine/normal/coarse seek, expiry, track identity, toggles, reset, repeat, exact app only'
