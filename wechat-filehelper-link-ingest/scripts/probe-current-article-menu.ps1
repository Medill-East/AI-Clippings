[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Get-TopLevelWindows {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  return @($root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition))
}

function Get-Descendants {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$Root
  )

  return @($Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition))
}

function Get-RectangleObject {
  param(
    [AllowNull()]
    [System.Windows.Automation.AutomationElement]$Element
  )

  if ($null -eq $Element) {
    return $null
  }

  $rect = $Element.Current.BoundingRectangle
  if ($rect.Width -le 0 -or $rect.Height -le 0) {
    return $null
  }

  return [ordered]@{
    left = [int][Math]::Round($rect.Left, 0)
    top = [int][Math]::Round($rect.Top, 0)
    width = [int][Math]::Round($rect.Width, 0)
    height = [int][Math]::Round($rect.Height, 0)
  }
}

function Get-PatternSupport {
  param(
    [Parameter(Mandatory = $true)]
    [System.Windows.Automation.AutomationElement]$Element
  )

  $invoke = $null
  $selection = $null
  $legacy = $null
  $expandCollapse = $null

  return [ordered]@{
    invoke = [bool]$Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)
    selection_item = [bool]$Element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selection)
    legacy = [bool]$Element.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$legacy)
    expand_collapse = [bool]$Element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$expandCollapse)
  }
}

function Get-CurrentArticleWindow {
  $wechatWindowName = ([char]0x5FAE) + ([char]0x4FE1)
  $windows = @(
    Get-TopLevelWindows |
      Where-Object {
        [string]$_.Current.ClassName -eq 'Chrome_WidgetWin_0' -and
        [string]$_.Current.Name -eq $wechatWindowName
      }
  )

  if ($windows.Count -eq 1) {
    return $windows[0]
  }

  return $null
}

$viewer = Get-CurrentArticleWindow
if ($null -eq $viewer) {
  [PSCustomObject]@{
    status = 'no_viewer'
    message = 'No open WeChat article viewer window was found.'
  } | ConvertTo-Json -Depth 6
  exit 0
}

$descendants = @(Get-Descendants -Root $viewer)
$menuLikeElements = @(
  $descendants |
    Where-Object {
      $name = [string]$_.Current.Name
      $type = [string]$_.Current.ControlType.ProgrammaticName
      $rect = Get-RectangleObject -Element $_
      if ($null -eq $rect) {
        return $false
      }

      $isMenuishType = $type -in @('ControlType.Menu', 'ControlType.MenuBar', 'ControlType.MenuItem', 'ControlType.Text', 'ControlType.Button')
      $isMenuishName = $name -like '*复制链接*' -or $name -like '*使用默认浏览器打开*' -or $name -like '*添加星标*' -or $name -like '*分享给朋友*' -or $name -like '*转发给朋友*' -or $name -like '*收藏*' -or $name -like '*查找*'
      $isMenuRegion = ($rect.top -lt 650 -and $rect.left -gt 700)
      return ($isMenuishType -and ($isMenuishName -or $isMenuRegion))
    }
)

$result = [ordered]@{
  status = 'ok'
  viewer = [ordered]@{
    handle = [string]$viewer.Current.NativeWindowHandle
    class = [string]$viewer.Current.ClassName
    name = [string]$viewer.Current.Name
  }
  menu_like_count = $menuLikeElements.Count
  menu_like_items = @(
    $menuLikeElements |
      Select-Object @{
        Name = 'name'
        Expression = { [string]$_.Current.Name }
      }, @{
        Name = 'control_type'
        Expression = { [string]$_.Current.ControlType.ProgrammaticName }
      }, @{
        Name = 'class'
        Expression = { [string]$_.Current.ClassName }
      }, @{
        Name = 'automation_id'
        Expression = { [string]$_.Current.AutomationId }
      }, @{
        Name = 'rectangle'
        Expression = { Get-RectangleObject -Element $_ }
      }, @{
        Name = 'patterns'
        Expression = { Get-PatternSupport -Element $_ }
      }
  )
}

$result | ConvertTo-Json -Depth 8
