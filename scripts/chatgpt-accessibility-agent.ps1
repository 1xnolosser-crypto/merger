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
$window=$null; $root=$null; $composer=$null; $snapshot=@(); $openedChatGPT=$false
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
    $chatTabExists = @($windows | Where-Object { $_.Title -match '(?i)chatgpt' }).Count -gt 0
    if(-not $chatTabExists -and -not $openedChatGPT) {
        $edge=Get-Command msedge.exe -ErrorAction SilentlyContinue
        if($edge) { Start-Process $edge.Source 'https://chatgpt.com/' }
        else { Start-Process 'https://chatgpt.com/' }
        $openedChatGPT=$true
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
$pageElements=@()
try {
    $uia=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
    $limit=[Math]::Min(120,$uia.Count)
    for($i=0;$i -lt $limit;$i++) {
        try {
            $v=$uia.Item($i).Current
            if(-not $v.IsOffscreen -and ($v.Name -or $v.AutomationId)) {
                $pageElements += [pscustomobject]@{type=$v.ControlType.ProgrammaticName; name=[string]$v.Name; automationId=[string]$v.AutomationId; helpText=[string]$v.HelpText; focusable=[bool]$v.IsKeyboardFocusable}
            }
        } catch {}
    }
} catch {}
$pageContext = "BROWSER ACCESSIBILITY SNAPSHOT (UI Automation; no screenshot/video):`n" + (($pageElements | ConvertTo-Json -Depth 5) -join "`n")
$messageToSend = $Report + "`n`n" + $pageContext
function Get-ComposerValue($element) {
    try {
        $p=$element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        return [string]$p.Current.Value
    } catch {}
    try {
        $p=$element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
        return [string]$p.DocumentRange.GetText(100000)
    } catch {}
    return $null
}
function Test-ChatGPTContainsMarker($root,$marker) {
    try {
        $nodes=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
        foreach($node in $nodes) {
            try {
                $name=[string]$node.Current.Name
                if($name.Contains($marker)) { return $true }
                try {
                    $p=$node.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                    if(([string]$p.Current.Value).Contains($marker)) { return $true }
                } catch {}
                try {
                    $p=$node.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
                    if(([string]$p.DocumentRange.GetText(100000)).Contains($marker)) { return $true }
                } catch {}
            } catch {}
        }
    } catch {}
    return $false
}
$old=$null; $haveOld=$false
try { $old=Get-Clipboard -Raw; $haveOld=$true } catch {}
try {
    $composer.SetFocus()
    Start-Sleep -Milliseconds 300
    if(-not $composer.Current.HasKeyboardFocus) {
        throw 'CHATGPT_AGENT_ABORTED: Composer did not receive keyboard focus. Nothing was pasted or sent.'
    }
    Set-Clipboard -Value $messageToSend
    $ws=New-Object -ComObject WScript.Shell
    $ws.SendKeys('^v')
    Start-Sleep -Milliseconds 900

    # Verify the pasted content. Prefer UI Automation; use a focused copy-back
    # only when Chromium does not expose ValuePattern/TextPattern.
    $expected=$messageToSend.Substring(0,[Math]::Min(48,$messageToSend.Length))
    $pasted=Get-ComposerValue $composer
    if($null -eq $pasted) {
        $ws.SendKeys('^a')
        Start-Sleep -Milliseconds 120
        $ws.SendKeys('^c')
        Start-Sleep -Milliseconds 250
        $pasted=Get-Clipboard -Raw -ErrorAction SilentlyContinue
        $ws.SendKeys('{END}')
        Start-Sleep -Milliseconds 100
    }
    if($null -eq $pasted -or -not ([string]$pasted).Contains($expected)) {
        throw 'CHATGPT_AGENT_ABORTED: Paste could not be verified inside the ChatGPT composer. Enter was not pressed.'
    }
    if([ChatGPTAgent.Native]::GetForegroundWindow() -ne $window.Handle -or
       [ChatGPTAgent.Native]::Title($window.Handle) -notmatch '(?i)chatgpt') {
        throw 'CHATGPT_AGENT_ABORTED: Focus changed before submission; Enter was not pressed.'
    }

    # Prefer the actual Send button when UI Automation exposes it; otherwise
    # press Enter only after paste verification.
    $sendButton=$null
    try {
        $buttons=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
            (New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::Button)))
        foreach($button in $buttons) {
            try {
                $bc=$button.Current
                if(-not $bc.IsOffscreen -and ($bc.AutomationId -eq 'send-button' -or $bc.Name -match '(?i)^send prompt$|^send
)) {
                    $sendButton=$button; break
                }
            } catch {}
        }
    } catch {}
    if($sendButton) {
        try {
            $invoke=$sendButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
            $invoke.Invoke()
        } catch { $ws.SendKeys('{ENTER}') }
    } else {
        $ws.SendKeys('{ENTER}')
    }

    # A keypress is NOT a submission confirmation. Require both a cleared
    # composer and the sent message to be present in the conversation tree.
    $marker=$Report.Substring(0,[Math]::Min(48,$Report.Length))
    $confirmed=$false
    $deadline=(Get-Date).AddSeconds(15)
    while((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
        if([ChatGPTAgent.Native]::GetForegroundWindow() -ne $window.Handle -or
           [ChatGPTAgent.Native]::Title($window.Handle) -notmatch '(?i)chatgpt') { break }
        $remaining=Get-ComposerValue $composer
        $composerEmpty=($null -ne $remaining -and [string]::IsNullOrWhiteSpace([string]$remaining))
        $messageVisible=Test-ChatGPTContainsMarker $root $marker
        if($composerEmpty -and $messageVisible) { $confirmed=$true; break }
    }
    if(-not $confirmed) {
        $state=[ordered]@{
            status='submission_unconfirmed'; checkedAt=(Get-Date).ToString('o')
            windowTitle=[ChatGPTAgent.Native]::Title($window.Handle)
            pasteVerified=$true; composerCleared=($composerEmpty -eq $true)
            sentMessageVisible=($messageVisible -eq $true)
            note='No success marker emitted; bridge must treat this as failure/uncertain.'
        }
        $state | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $LogPath -Encoding UTF8
        throw 'CHATGPT_AGENT_ABORTED: Paste was verified, but the conversation did not confirm the sent message. Submission status is uncertain.'
    }
    $state=[ordered]@{
        status='submitted_and_verified'; checkedAt=(Get-Date).ToString('o')
        windowTitle=[ChatGPTAgent.Native]::Title($window.Handle)
        composerAutomationId=[string]$composer.Current.AutomationId
        reportCharacters=$Report.Length; pasteVerified=$true
        composerCleared=$true; sentMessageVisible=$true
        method='UI Automation composer readback + send control/Enter + conversation readback'
    }
    $state | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $LogPath -Encoding UTF8
    'CHATGPT_ACCESSIBILITY_AGENT_SUBMITTED'
    'PASTE_VERIFIED: true'
    'SUBMISSION_VERIFIED: true'
    "Window: $($state.windowTitle)"
    "Log: $LogPath"
} finally {
    if($haveOld) { Set-Clipboard -Value $old }
}
