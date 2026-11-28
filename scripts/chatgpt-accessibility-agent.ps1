# ChatGPT Accessibility Agent for Windows PowerShell 5.1
# Reads Edge's UI Automation tree (no screenshots, video, OCR, or browser extensions).
# Opens ChatGPT if needed, identifies the ChatGPT tab, focuses its composer, and sends a report.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidateNotNullOrEmpty()][string]$Report,
    [int]$WaitSeconds = 35,
    [string]$LogPath = "$env:LOCALAPPDATA\MergerRemote\chatgpt-accessibility.json"
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
if (-not ('ChatGPTAgent.Native' -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
namespace ChatGPTAgent {
 public sealed class Win { public IntPtr Handle {get;set;} public int Pid {get;set;} public string Title {get;set;} }
 public static class Native {
  private delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h, int c);
  public static string Title(IntPtr h) { var b=new StringBuilder(1024); GetWindowText(h,b,b.Capacity); return b.ToString(); }
  public static bool Activate(IntPtr h) { ShowWindowAsync(h,9); return SetForegroundWindow(h); }
  public static Win[] EdgeWindows() {
   var a=new List<Win>();
   EnumWindows((h,l)=>{ if(!IsWindowVisible(h)) return true; var c=new StringBuilder(256); GetClassName(h,c,c.Capacity); if(c.ToString()!="Chrome_WidgetWin_1") return true; uint p; GetWindowThreadProcessId(h,out p); try { using(var pr=Process.GetProcessById((int)p)) { if(pr.ProcessName.Equals("msedge",StringComparison.OrdinalIgnoreCase)) a.Add(new Win{Handle=h,Pid=(int)p,Title=Title(h)}); } } catch {} return true; },IntPtr.Zero);
   return a.ToArray();
  }
 }
}
"@
}
function Find-Composer($root) {
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
    $items = @()
    foreach($e in $all) {
        try {
            $c=$e.Current
            if($c.IsOffscreen) { continue }
            $items += [pscustomobject]@{
                Name=[string]$c.Name; AutomationId=[string]$c.AutomationId
                Type=[string]$c.ControlType.ProgrammaticName
                Focusable=[bool]$c.IsKeyboardFocusable
            }
            if($c.AutomationId -eq 'prompt-textarea' -and $c.IsKeyboardFocusable) { return $e }
        } catch {}
    }
    $candidates=@($all | Where-Object {
        try {
            $c=$_.Current
            -not $c.IsOffscreen -and $c.IsKeyboardFocusable -and
            ($c.ControlType -eq [System.Windows.Automation.ControlType]::Edit -or
             $c.ControlType -eq [System.Windows.Automation.ControlType]::Document)
        } catch { $false }
    })
    if($candidates.Count -gt 0) { return $candidates[$candidates.Count-1] }
    return $null
}
$logDir=Split-Path -Parent $LogPath
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$deadline=(Get-Date).AddSeconds($WaitSeconds)
$window=$null; $root=$null; $composer=$null; $snapshot=@()
while((Get-Date) -lt $deadline) {
    $windows=@([ChatGPTAgent.Native]::EdgeWindows())
    foreach($w in $windows) {
        if($w.Title -notmatch '(?i)chatgpt') { continue }
        [void][ChatGPTAgent.Native]::Activate($w.Handle)
        Start-Sleep -Milliseconds 350
        if([ChatGPTAgent.Native]::GetForegroundWindow() -ne $w.Handle) { continue }
        try {
            $r=[System.Windows.Automation.AutomationElement]::FromHandle($w.Handle)
            if(-not $r) { continue }
            $c=Find-Composer $r
            $snapshot += [pscustomobject]@{WindowTitle=$w.Title; ProcessId=$w.Pid; ComposerFound=[bool]$c}
            if($c) { $window=$w; $root=$r; $composer=$c; break }
        } catch {}
    }
    if($composer) { break }
    if($windows.Count -eq 0) {
        $edge=Get-Command msedge.exe -ErrorAction SilentlyContinue
        if($edge) { Start-Process $edge.Source 'https://chatgpt.com/' }
        else { Start-Process 'https://chatgpt.com/' }
    }
    Start-Sleep -Seconds 2
}
if(-not $composer) {
    $state=[ordered]@{status='composer_not_found'; checkedAt=(Get-Date).ToString('o'); windows=$snapshot; note='No screenshot or keystrokes were used.'}
    $state | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $LogPath -Encoding UTF8
    throw 'CHATGPT_AGENT_ABORTED: ChatGPT tab/composer not accessible through UI Automation. No text sent.'
}
# Revalidate destination immediately before focusing or typing.
if([ChatGPTAgent.Native]::GetForegroundWindow() -ne $window.Handle -or
   [ChatGPTAgent.Native]::Title($window.Handle) -notmatch '(?i)chatgpt') {
    throw 'CHATGPT_AGENT_ABORTED: ChatGPT is not the foreground window. No text sent.'
}
$old=$null; $haveOld=$false
try { $old=Get-Clipboard -Raw; $haveOld=$true } catch {}
try {
    $composer.SetFocus()
    Start-Sleep -Milliseconds 250
    Set-Clipboard -Value $Report
    $ws=New-Object -ComObject WScript.Shell
    $ws.SendKeys('^v')
    Start-Sleep -Milliseconds 800
    if([ChatGPTAgent.Native]::GetForegroundWindow() -ne $window.Handle -or
       [ChatGPTAgent.Native]::Title($window.Handle) -notmatch '(?i)chatgpt') {
        throw 'CHATGPT_AGENT_ABORTED: Focus changed before submission; Enter was not pressed.'
    }
    $ws.SendKeys('{ENTER}')
    Start-Sleep -Seconds 2
    $state=[ordered]@{
        status='submitted_to_chatgpt'; checkedAt=(Get-Date).ToString('o')
        windowTitle=[ChatGPTAgent.Native]::Title($window.Handle)
        composerAutomationId=[string]$composer.Current.AutomationId
        reportCharacters=$Report.Length
        method='UI Automation + clipboard; no screenshots/video/OCR'
    }
    $state | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $LogPath -Encoding UTF8
    'CHATGPT_ACCESSIBILITY_AGENT_SUBMITTED'
    "Window: $($state.windowTitle)"
    "Log: $LogPath"
} finally {
    if($haveOld) { Set-Clipboard -Value $old }
}
