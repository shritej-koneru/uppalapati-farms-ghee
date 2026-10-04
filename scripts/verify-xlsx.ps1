# Verifies a workbook opens in Excel with no repair prompt, and reports what is in it.
# Usage: powershell -File scripts/verify-xlsx.ps1 -Path <file.xlsx>
#
# Needs Excel, so it is deliberately outside `npm run check`.
#
# The expected Status fills are read out of src/order-status.js at run time rather
# than written here, so this script cannot end up disagreeing with the sheet about
# what a status looks like. Node is already needed to have built the file being
# checked, so asking it one question costs nothing.

param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$StatusModule = 'src/order-status.js'
)

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not [System.IO.Path]::IsPathRooted($StatusModule)) {
  $StatusModule = Join-Path $repoRoot $StatusModule
}
if (-not [System.IO.Path]::IsPathRooted($Path)) {
  $Path = Join-Path $repoRoot $Path
}

$excel = $null
$book = $null

if (-not (Test-Path $Path)) { throw "No such workbook: $Path" }
if (-not (Test-Path $StatusModule)) { throw "No such status module: $StatusModule" }

# A failure here is a failure of the check, not something to shrug off and print
# anyway: comparing against nothing reports every fill as correct.
$moduleUrl = 'file:///' + $StatusModule.Replace('\', '/')
$expectedJson = & node --input-type=module -e "import('$moduleUrl').then((m) => process.stdout.write(JSON.stringify(m.STATUS_FILLS)))" 2>&1
if ($LASTEXITCODE -ne 0 -or -not $expectedJson) {
  throw "Could not read STATUS_FILLS from $StatusModule : $expectedJson"
}
$expectedStatusFills = $expectedJson | ConvertFrom-Json
if ($null -eq $expectedStatusFills) { throw "STATUS_FILLS in $StatusModule is empty." }

try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AskToUpdateLinks = $false

  # CorruptLoad = 0 (xlNormalLoad) is the whole point: Excel only raises here when
  # the file is damaged, rather than silently repairing it into a usable workbook.
  $book = $excel.Workbooks.Open($Path, 0, $true, [Type]::Missing, [Type]::Missing, [Type]::Missing, $true, [Type]::Missing, [Type]::Missing, [Type]::Missing, [Type]::Missing, [Type]::Missing, [Type]::Missing, 0)

  $sheet = $book.Worksheets.Item(1)
  $used = $sheet.UsedRange

  Write-Output ("opened cleanly     : yes")
  Write-Output ("used range         : {0} ({1} rows x {2} columns)" -f $used.Address(0, 0), $used.Rows.Count, $used.Columns.Count)

  $columns = $used.Columns.Count
  $headers = @()
  for ($c = 1; $c -le $columns; $c++) { $headers += [string]$sheet.Cells.Item(1, $c).Value2 }
  Write-Output ("header row         : {0}" -f ($headers -join ' | '))
  Write-Output ("header is bold     : {0}" -f $sheet.Cells.Item(1, 1).Font.Bold)

  for ($r = 2; $r -le $used.Rows.Count; $r++) {
    Write-Output ("row {0}             : {1}" -f $r, (($used.Rows.Item($r).Value2 | ForEach-Object { [string]$_ }) -join ' | '))
  }

  # The Total column must be a real number, not text, or nothing can sum it.
  $totalCol = [Array]::IndexOf($headers, 'Total') + 1
  if ($totalCol -gt 0) {
    $value = $sheet.Cells.Item(2, $totalCol).Value2
    Write-Output ("Total column       : index {0}, type {1}, value {2}" -f $totalCol, $(if ($null -eq $value) { 'empty' } else { $value.GetType().Name }), $value)
  }

  Write-Output ("status cell        : A2 = '{0}'" -f $sheet.Cells.Item(2, 1).Value2)

  # The interior colour of every Status cell, read back the way Excel sees it. A
  # fill that did not survive the open is the difference between a sheet that
  # answers "which of these are still to go" at a glance and one that does not, and
  # this is the only place that can tell — a well-formed sheet with a fill index
  # Excel quietly ignores looks perfect to everything that does not use Excel.
  Write-Output ''
  Write-Output 'status fills, as Excel reads them back'
  $wrong = 0
  for ($r = 2; $r -le $used.Rows.Count; $r++) {
    $cell = $sheet.Cells.Item($r, 1)
    $label = [string]$cell.Value2
    $colour = [int64]$cell.Interior.Color

    # Interior.Color is a BGR long: the low byte is red. Reversing it wrongly once
    # already printed every fill as its own complement, which reads as plausible.
    $red = $colour -band 0xFF
    $green = ($colour -shr 8) -band 0xFF
    $blue = ($colour -shr 16) -band 0xFF
    $rgb = '#{0:X2}{1:X2}{2:X2}' -f $red, $green, $blue

    $verdict = ''
    $expected = $expectedStatusFills.$label
    if ($null -eq $expected) {
      $verdict = '  <- not a status this build knows'
      $wrong += 1
    }
    elseif ($rgb -ne ('#{0}' -f $expected.Substring(2))) {
      $verdict = '  <- expected #{0}' -f $expected.Substring(2).ToUpper()
      $wrong += 1
    }

    Write-Output ("  {0,-12} {1}{2}" -f $label, $rgb, $verdict)
  }

  $tinted = 0
  for ($r = 2; $r -le $used.Rows.Count; $r++) {
    if ([int64]$sheet.Cells.Item($r, 1).Interior.Color -ne 16777215) { $tinted += 1 }
  }
  Write-Output ("status cells tinted: {0} of {1}" -f $tinted, ($used.Rows.Count - 1))
  if ($wrong -gt 0) {
    Write-Output ("status fills wrong : {0}" -f $wrong)
    exit 1
  }
}
catch {
  Write-Output ("opened cleanly     : NO - {0}" -f $_.Exception.Message)
  exit 1
}
finally {
  if ($book) { $book.Close($false) }
  if ($excel) { $excel.Quit() }
  if ($book) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($book) }
  if ($excel) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
  [GC]::Collect()
}