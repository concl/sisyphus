$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public static class DesktopInput {
  public static string CancelFile;
  public static void Check() { if (File.Exists(CancelFile)) throw new Exception("Request stopped"); }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
  [StructLayout(LayoutKind.Explicit)] struct UNION {
    [FieldOffset(0)] public MOUSE mouse;
    [FieldOffset(0)] public KEY key;
  }
  [StructLayout(LayoutKind.Sequential)] struct MOUSE { public int x,y; public uint data,flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEY { public ushort vk,scan; public uint flags,time; public UIntPtr extra; }
  static void Send(INPUT input) {
    if (SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT))) != 1)
      throw new Exception("Windows rejected input. The target may be elevated or on a protected desktop.");
  }
  public static void Move(int x, int y) { if (!SetCursorPos(x,y)) throw new Exception("Cannot move pointer on this desktop."); }
  public static void Mouse(uint flags, int data) { Send(new INPUT { type=0, u=new UNION { mouse=new MOUSE { flags=flags, data=unchecked((uint)data) } } }); }
  static void Key(ushort vk, ushort scan, uint flags) { Send(new INPUT { type=1, u=new UNION { key=new KEY { vk=vk, scan=scan, flags=flags } } }); }
  public static void Text(string text) {
    foreach (char c in text) { Check(); try { Key(0,c,4); } finally { Key(0,c,6); } }
  }
  public static ushort KeyCode(string name) {
    name=name.ToUpperInvariant();
    if (name.Length==1 && char.IsLetterOrDigit(name[0]) && name[0]<128) return name[0];
    int f; if (name.StartsWith("F") && int.TryParse(name.Substring(1),out f) && f>=1 && f<=12) return (ushort)(111+f);
    switch(name) {
      case "CTRL": return 17; case "SHIFT": return 16; case "ALT": return 18; case "WIN": return 91;
      case "ENTER": return 13; case "TAB": return 9; case "ESC": return 27; case "SPACE": return 32;
      case "BACKSPACE": return 8; case "DELETE": return 46; case "HOME": return 36; case "END": return 35;
      case "PAGEUP": return 33; case "PAGEDOWN": return 34;
      case "LEFT": return 37; case "UP": return 38; case "RIGHT": return 39; case "DOWN": return 40;
      default: throw new Exception("Unsupported key: "+name);
    }
  }
  public static void Chord(string[] names) {
    ushort[] keys=Array.ConvertAll(names, KeyCode); int held=0;
    try { foreach(ushort k in keys) { Check(); Key(k,0,(k>=33 && k<=46 || k==91)?1u:0u); held++; } }
    finally { for(int i=held-1;i>=0;i--) Key(keys[i],0,2u | ((keys[i]>=33 && keys[i]<=46 || keys[i]==91)?1u:0u)); }
  }
  public static string Capture(int x,int y,int w,int h,int width,int height) {
    using(var bitmap=new Bitmap(w,h)) {
      using(var g=Graphics.FromImage(bitmap)) g.CopyFromScreen(x,y,0,0,new Size(w,h));
      using(var resized=new Bitmap(width,height)) {
        using(var g=Graphics.FromImage(resized)) g.DrawImage(bitmap,0,0,width,height);
        using(var stream=new MemoryStream()) { resized.Save(stream,ImageFormat.Png); return Convert.ToBase64String(stream.ToArray()); }
      }
    }
  }
}
'@
[void][DesktopInput]::SetProcessDPIAware()
function Point($frame, $x, $y) {
  if ($x -lt 0 -or $y -lt 0 -or $x -ge $frame.width -or $y -ge $frame.height) { throw 'Point is outside the screenshot.' }
  return @([int]($frame.left + [Math]::Floor($x * $frame.screenWidth / $frame.width)), [int]($frame.top + [Math]::Floor($y * $frame.screenHeight / $frame.height)))
}
while ($null -ne ($line = [Console]::ReadLine())) {
  try {
    $request = $line | ConvertFrom-Json
    [DesktopInput]::CancelFile = $request.cancelFile
    [DesktopInput]::Check()
    $screens = @([System.Windows.Forms.Screen]::AllScreens)
    $display = if ($request.action -eq 'screenshot') { if ($null -eq $request.display) { 0 } else { [int]$request.display } } else { [int]$request.frame.display }
    if ($display -lt 0 -or $display -ge $screens.Count) { throw 'Display is no longer available.' }
    $bounds = $screens[$display].Bounds
    $frame = $request.frame
    if ($request.action -ne 'screenshot') {
      if ($bounds.X -ne $frame.left -or $bounds.Y -ne $frame.top -or $bounds.Width -ne $frame.screenWidth -or $bounds.Height -ne $frame.screenHeight) { throw 'Display layout changed. Take another screenshot.' }
      switch ($request.action) {
        'click' {
          $point = Point $frame $request.x $request.y
          [DesktopInput]::Move($point[0],$point[1])
          $down,$up = switch ($request.button) { 'right' {8;16} 'middle' {32;64} default {2;4} }
          for ($i=0; $i -lt $request.count; $i++) { [DesktopInput]::Check(); try { [DesktopInput]::Mouse($down,0) } finally { [DesktopInput]::Mouse($up,0) }; Start-Sleep -Milliseconds 70 }
        }
        'type' { [DesktopInput]::Text($request.text) }
        'key' { [DesktopInput]::Chord([string[]]$request.keys) }
        'scroll' { $point=Point $frame $request.x $request.y; [DesktopInput]::Move($point[0],$point[1]); [DesktopInput]::Mouse(2048,([int]$request.amount * 120)) }
        'drag' {
          $point=Point $frame $request.x $request.y; $end=Point $frame $request.toX $request.toY
          [DesktopInput]::Move($point[0],$point[1])
          try { [DesktopInput]::Mouse(2,0); for($i=1;$i -le 15;$i++) { [DesktopInput]::Check(); [DesktopInput]::Move([int]($point[0]+($end[0]-$point[0])*$i/15),[int]($point[1]+($end[1]-$point[1])*$i/15)); Start-Sleep -Milliseconds 20 } }
          finally { [DesktopInput]::Mouse(4,0) }
        }
        default { throw 'Unknown desktop action.' }
      }
      Start-Sleep -Milliseconds 200
    }
    [DesktopInput]::Check()
    $ratio=[Math]::Min(1.0,1600 / [double]$bounds.Width)
    $width=[int][Math]::Round($bounds.Width*$ratio); $height=[int][Math]::Round($bounds.Height*$ratio)
    $image=[DesktopInput]::Capture($bounds.X,$bounds.Y,$bounds.Width,$bounds.Height,$width,$height)
    $displays=@(for($i=0;$i -lt $screens.Count;$i++) { @{display=$i; name=$screens[$i].DeviceName; primary=$screens[$i].Primary} })
    @{image=$image; display=$display; displays=$displays; width=$width; height=$height; left=$bounds.X; top=$bounds.Y; screenWidth=$bounds.Width; screenHeight=$bounds.Height} | ConvertTo-Json -Compress -Depth 6 | ForEach-Object { [Console]::WriteLine($_) }
  } catch { [Console]::WriteLine((@{error=$_.Exception.Message} | ConvertTo-Json -Compress)) }
}
