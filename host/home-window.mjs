// Compact initial window within the chosen display work area; resizing stays available.
export function homeWindowBounds(workArea) {
  const width=Math.max(1,Math.min(1080,workArea.width-32)),height=Math.max(1,Math.min(780,workArea.height-32))
  return {width,height,minWidth:Math.min(760,width),minHeight:Math.min(600,height),x:Math.round(workArea.x+(workArea.width-width)/2),y:Math.round(workArea.y+(workArea.height-height)/2)}
}
