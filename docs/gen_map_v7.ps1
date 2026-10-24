$out = "C:\Users\Kesar Doshi\Desktop\MESA\AI and its Applications\Demand Planning\docs"
New-Item -ItemType Directory -Force $out | Out-Null
$W=2000; $H=1540
$cols='Trigger','Input','Context','Processing','AI','Output'
$cx=@(340,642,944,1246,1547,1849)
function RT($i){ 135+118*$i }
$rows=@(
 @{n='SAP ERP';s='IT team &#183; Source';bg='#eceefe';fill='#e0e7ff';st='#4f46e5';c=0;t=@('Exports the CSV files Tue / Fri:','sales, stock, SKU list,','festival calendar')},
 @{n='Backend loader';s='Backend &#183; not in dashboard';bg='#e9f1fe';fill='#dbeafe';st='#2563eb';c=1;t=@('Loads the CSVs into Neon','(npm run seed); keeps SKUs, vendors,','stock and rules current there','Every row checked before saving')},
 @{n='Neon database';s='Single source of truth';bg='#e7f7ec';fill='#dcfce7';st='#16a34a';c=2;t=@('SKUs, vendors, sales, stock,','calendar, rules, manual SKU info,','decisions and POs','POs not received = on order')},
 @{n='Rules Engine';s='Dashboard &#183; server';bg='#fef7dc';fill='#fef3c7';st='#ca8a04';c=3;t=@('Run planning (button, on saving','manual info, or Tue/Fri)','Raghav''s 5 rules, read from Neon','1 rec per SKU, priority score')},
 @{n='Gemini API';s='Explain';bg='#fdf0f8';fill='#fce7f3';st='#db2777';c=4;t=@('1-line reason per flag','Trend & anomaly summary','Words engine numbers only,','never computes qty or forecast')},
 @{n='Review tab';s='Raghav + Deepa &#183; human gate';bg='#fff4df';fill='#ffedd5';st='#ea580c';c=5;t=@('Approve, Edit (qty + reason)','or Reject (reason). Pick your name','in the top bar; no login','New / no-data SKUs: enter info by hand')},
 @{n='PO PDF';s='Dashboard &#183; automatic';bg='#f1f3f5';fill='#e2e8f0';st='#475569';c=5;t=@('Approve creates that line''s PO','Numbered DP-YYYY-NNNN, in the','standard PO format','(nothing without approval)')},
 @{n='Purchase orders tab';s='Dashboard';bg='#eef2f7';fill='#dfe7f1';st='#334155';c=5;t=@('Every PO listed: preview or','download the PDF and send it to','the vendor yourself','then mark received')},
 @{n='Overrides and Feedback';s='Raghav + Deepa';bg='#f3eefe';fill='#ede9fe';st='#7c3aed';c=3;t=@('Every decision and reason kept','Same rule changed >=3x in 4 wks','-> queued on Overview (Rules dropdown)','Raghav + Deepa edit the rule in Neon')},
 @{n='Overview tab';s='Dashboard &#183; incl. impact';bg='#fdeeee';fill='#fee2e2';st='#dc2626';c=3;t=@('KPIs, charts, guardrails, rules shown','Impact: weekly losses (finance entries)','vs pre-AI baseline; day-90 verdict:','keep, review, or back to manual')},
 @{n='Stock tab';s='Dashboard &#183; live from Neon';bg='#e9f7f6';fill='#d5f0ec';st='#0f766e';c=3;t=@('Every SKU by priority: in hand,','on order, weeks of cover vs target band','New / no-data SKUs tagged Manual;','Edit saves to Neon, planning reruns')}
)
$sb=New-Object System.Text.StringBuilder
function A($s){ [void]$sb.AppendLine($s) }
A "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 $W $H' width='$W' height='$H' font-family='Segoe UI, Arial, sans-serif'>"
A "<defs>"
foreach($m in @(@('g','#475569'),@('o','#ea580c'),@('gr','#16a34a'),@('p','#7c3aed'),@('t','#0f766e'),@('r','#dc2626'))){ A "<marker id='m$($m[0])' viewBox='0 0 10 10' refX='8' refY='5' markerWidth='8' markerHeight='8' orient='auto-start-reverse'><path d='M0,0 L10,5 L0,10 z' fill='$($m[1])'/></marker>" }
A "</defs>"
A "<rect width='$W' height='$H' fill='#ffffff'/>"
A "<text x='1000' y='46' text-anchor='middle' font-size='22' font-weight='700' fill='#111'>Demand Planning &#183; Freshroots &#8212; Components Map (v7)</text>"
A "<rect x='0' y='80' width='$W' height='55' fill='#14213d'/>"
A "<text x='95' y='113' text-anchor='middle' font-size='15' font-weight='700' fill='#fff'>Actor</text>"
for($k=0;$k -lt 6;$k++){ A "<text x='$($cx[$k])' y='113' text-anchor='middle' font-size='16' font-weight='700' fill='#fff'>$($cols[$k])</text>" }
for($i=0;$i -lt $rows.Count;$i++){
 $r=$rows[$i]; $y=RT $i
 A "<rect x='190' y='$y' width='1810' height='118' fill='$($r.bg)'/>"
 A "<rect x='0' y='$y' width='190' height='118' fill='#14213d'/>"
 A "<line x1='0' y1='$y' x2='$W' y2='$y' stroke='#fff' stroke-opacity='.6'/>"
 A "<text x='95' y='$($y+55)' text-anchor='middle' font-size='15' font-weight='700' fill='#fff'>$($r.n)</text>"
 A "<text x='95' y='$($y+74)' text-anchor='middle' font-size='11' fill='#a9b4cc'>$($r.s)</text>"
}
# human gate band
$gy=RT 5
A "<rect x='191' y='$gy' width='1807' height='118' fill='none' stroke='#ff6a00' stroke-width='3' stroke-dasharray='14 8'/>"
A "<text x='200' y='$($gy+18)' font-size='11' font-weight='700' fill='#e25500'>HUMAN GATE</text>"
# arrows
function P($d,$cls,$mk,$dot){ A "<path d='$d' fill='none' stroke='$cls' stroke-width='2' stroke-dasharray='6 5' marker-end='url(#m$mk)'/>"; if($dot){ A "<circle cx='$($dot[0])' cy='$($dot[1])' r='4.5' fill='#22c55e'/>" } }
$g='#475569'
function Top($i){ (RT $i)+13 }
function Bot($i){ (RT $i)+105 }
function Cy($i){ (RT $i)+59 }
function Mid($i){ (RT $i)+118 }
P "M340,$(Bot 0) V$(Mid 0) H642 V$(Top 1)" $g 'g' @(340,(Bot 0))
P "M642,$(Bot 1) V$(Mid 1) H944 V$(Top 2)" $g 'g' @(642,(Bot 1))
P "M1075,$(Cy 2) H1246 V$(Top 3)" $g 'g' @(1075,(Cy 2))
P "M1246,$(Bot 3) V$(Mid 3) H1547 V$(Top 4)" $g 'g' @(1246,(Bot 3))
P "M1547,$(Bot 4) V$(Mid 4) H1849 V$(Top 5)" '#ea580c' 'o' @(1547,(Bot 4))
P "M1849,$(Bot 5) V$(Top 6)" '#16a34a' 'gr' @(1849,(Bot 5))
P "M1849,$(Bot 6) V$(Top 7)" '#16a34a' 'gr' @(1849,(Bot 6))
P "M1718,$(Cy 5) H1246 V$(Top 8)" '#7c3aed' 'p' @(1718,(Cy 5))
P "M1115,$(Cy 8) H900 V$(Bot 2)" '#7c3aed' 'p' @(1115,(Cy 8))
# Stock tab: reads Neon live; hand-entered SKU info goes back to Neon and re-runs planning
P "M1010,$(Bot 2) V$(Cy 10) H1115" '#0f766e' 't' @(1010,(Bot 2))
A "<text x='1000' y='$((Cy 10)+34)' text-anchor='end' font-size='11' fill='#0f766e'>reads Neon live; hand-entered</text>"
A "<text x='1000' y='$((Cy 10)+49)' text-anchor='end' font-size='11' fill='#0f766e'>SKU info saved back, planning reruns</text>"
A "<text x='1708' y='$((Cy 5)-8)' text-anchor='end' font-size='11' fill='#7c3aed'>changed qty / rejects + reason</text>"
A "<text x='1860' y='$((Bot 5)+13)' font-size='11' fill='#16a34a'>approved</text>"
A "<text x='1860' y='$((Bot 6)+13)' font-size='11' fill='#16a34a'>ready</text>"
A "<text x='888' y='$((RT 6)+40)' text-anchor='end' font-size='11' fill='#7c3aed'>Raghav + Deepa edit</text>"
A "<text x='888' y='$((RT 6)+55)' text-anchor='end' font-size='11' fill='#7c3aed'>the rule (never automatic)</text>"
A "<text x='995' y='$((Cy 9)-6)' text-anchor='end' font-size='11' fill='#dc2626'>reads runs, decisions, rules;</text>"
A "<text x='995' y='$((Cy 9)+9)' text-anchor='end' font-size='11' fill='#dc2626'>finance's weekly losses saved to Neon</text>"
# Overview tab: reads runs, decisions, impact entries and rules from Neon; finance entries are saved back; its button runs planning
P "M1040,$(Bot 2) V$(Cy 9) H1115" '#dc2626' 'r' @(1040,(Bot 2))
P "M1377,$(Cy 9) H1395 V$(Cy 3) H1377" '#dc2626' 'r' @(1377,(Cy 9))
A "<text x='1405' y='$((Cy 9)-8)' font-size='11' fill='#dc2626'>Run planning now</text>"
# boxes
for($i=0;$i -lt $rows.Count;$i++){
 $r=$rows[$i]; $y=(RT $i)+13; $x=$cx[$r.c]-131
 A "<rect x='$x' y='$y' width='262' height='92' rx='8' fill='$($r.fill)' stroke='$($r.st)' stroke-width='2.5'/>"
 $n=$r.t.Count; $ty=$y+46-($n-1)*9+4
 for($j=0;$j -lt $n;$j++){ $line=[System.Security.SecurityElement]::Escape($r.t[$j]); A "<text x='$($cx[$r.c])' y='$($ty+18*$j)' text-anchor='middle' font-size='12.5' fill='#1f2937'>$line</text>" }
}
A "<text x='190' y='1500' font-size='12.5' fill='#374151'>Dashed arrows = data flow  |  Orange band = human gate: no PO without Raghav or Deepa approving  |  Purple = feedback loop, human-approved (rules never self-edit)  |  A PO counts as stock on order until marked received</text>"
A "<text x='190' y='1520' font-size='12.5' fill='#374151'>Teal = Stock tab: live view, hand-entered SKU info saved back  |  Red = Overview: reads Neon, saves finance's loss entries, can start a run  |  No login, no email: Neon is the one database</text>"
A "</svg>"
$sb.ToString() | Set-Content -Encoding utf8 "$out\demand_planning_components_map_v7.svg"
"written"

