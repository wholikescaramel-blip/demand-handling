$out = "C:\Users\Kesar Doshi\Desktop\MESA\AI and its Applications\Demand Planning\docs"
New-Item -ItemType Directory -Force $out | Out-Null
$W=2000; $H=1550
$cols='Trigger','Input','Context','Processing','AI','Output'
$cx=@(340,642,944,1246,1547,1849)
function RT($i){ 135+118*$i }
$rows=@(
 @{n='SAP ERP';s='IT team &#183; Source';bg='#eceefe';fill='#e0e7ff';st='#4f46e5';c=0;t=@('Scheduled export Tue / Fri','CSV to Drive folder','Alert if file missing or stale')},
 @{n='Drive + Sheets';s='Data layer';bg='#e9f1fe';fill='#dbeafe';st='#2563eb';c=1;t=@('Loads CSV into clean tabs','SKU x week, completeness >95%','As-of date <= 4 days old','Stock snapshot kept as history')},
 @{n='On-order POs';s='Generated, not received';bg='#e6f7f4';fill='#ccfbf1';st='#0d9488';c=1;t=@('POs we generated and nobody has','marked received count as stock on','order, so flags do not re-order','what is already out')},
 @{n='Rules_Config';s='Context';bg='#e7f7ec';fill='#dcfce7';st='#16a34a';c=2;t=@("Raghav's 5 rules, editable:",'thresholds, uplift on cover baseline,','precedence order','+ sku_master, calendar, perishables')},
 @{n='Rules Engine';s='Apps Script';bg='#fef7dc';fill='#fef3c7';st='#ca8a04';c=3;t=@('Trends: 4-wk vs 12-wk avg','Rules + precedence, 1 rec per SKU','Priority score; <12 wks hist = manual','Shadow mode: log only, first 4 wks')},
 @{n='Gemini API';s='Explain';bg='#fdf0f8';fill='#fce7f3';st='#db2777';c=4;t=@('1-line reason per flag','Trend & anomaly summary','Words engine numbers only,','never computes qty or forecast')},
 @{n='Review Dashboard';s='Raghav &#183; Vercel + Neon';bg='#fff4df';fill='#ffedd5';st='#ea580c';c=5;t=@('Approve / reject / override qty','Reason logged on every change','24h SLA, backup approver named','Pending list pushed from the Sheet')},
 @{n='PO PDF';s='Dashboard &#183; automatic';bg='#f1f3f5';fill='#e2e8f0';st='#475569';c=5;t=@('Approved REORDERs become a PO','One per vendor, DP-YYYY-NNNN,','in the standard PO format','(nothing is made without approval)')},
 @{n='Download or email';s='Dashboard buttons';bg='#eef2f7';fill='#dfe7f1';st='#334155';c=5;t=@('Download the PDF, or email it','to the vendor from the dashboard','(sent from your Gmail through','an Apps Script web app)')},
 @{n='Overrides and Feedback';s='Raghav + Deepa';bg='#f3eefe';fill='#ede9fe';st='#7c3aed';c=3;t=@('Decisions mirrored back to the Sheet','Override reasons logged, PO numbers','Same rule overridden >=3x in 4 wks','-> rule review (human-approved)')},
 @{n='Impact tracker';s='Finance &#183; weekly entries';bg='#fdeeee';fill='#fee2e2';st='#dc2626';c=3;t=@('Weekly losses (stockout + overstock)','vs the pre-AI baseline, as a graph','Day-90 verdict: keep, review,','or shift back to manual')}
)
$sb=New-Object System.Text.StringBuilder
function A($s){ [void]$sb.AppendLine($s) }
A "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 $W $H' width='$W' height='$H' font-family='Segoe UI, Arial, sans-serif'>"
A "<defs>"
foreach($m in @(@('g','#475569'),@('o','#ea580c'),@('gr','#16a34a'),@('p','#7c3aed'))){ A "<marker id='m$($m[0])' viewBox='0 0 10 10' refX='8' refY='5' markerWidth='8' markerHeight='8' orient='auto-start-reverse'><path d='M0,0 L10,5 L0,10 z' fill='$($m[1])'/></marker>" }
A "</defs>"
A "<rect width='$W' height='$H' fill='#ffffff'/>"
A "<text x='1000' y='46' text-anchor='middle' font-size='22' font-weight='700' fill='#111'>Demand Planning &#183; Freshroots &#8212; Components Map (v5)</text>"
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
$gy=RT 6
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
P "M511,$(Cy 1) H496 V$((Cy 4)+14) H1115" $g 'g' @(511,(Cy 1))
P "M773,$(Cy 2) H793 V$((Cy 4)-14) H1115" $g 'g' @(773,(Cy 2))
P "M1075,$(Cy 3) H1246 V$(Top 4)" $g 'g' @(1075,(Cy 3))
P "M1246,$(Bot 4) V$(Mid 4) H1547 V$(Top 5)" $g 'g' @(1246,(Bot 4))
P "M1547,$(Bot 5) V$(Mid 5) H1849 V$(Top 6)" '#ea580c' 'o' @(1547,(Bot 5))
P "M1849,$(Bot 6) V$(Top 7)" '#16a34a' 'gr' @(1849,(Bot 6))
P "M1849,$(Bot 7) V$(Top 8)" '#16a34a' 'gr' @(1849,(Bot 7))
P "M1718,$(Cy 6) H1246 V$(Top 9)" '#7c3aed' 'p' @(1718,(Cy 6))
P "M1115,$(Cy 9) H944 V$(Bot 3)" '#7c3aed' 'p' @(1115,(Cy 9))
A "<text x='1708' y='$((Cy 6)-8)' text-anchor='end' font-size='11' fill='#7c3aed'>overrides / rejects + reason</text>"
A "<text x='1860' y='$((Bot 6)+13)' font-size='11' fill='#16a34a'>approved</text>"
A "<text x='1860' y='$((Bot 7)+13)' font-size='11' fill='#16a34a'>auto</text>"
A "<text x='1100' y='$((Cy 10)-6)' text-anchor='end' font-size='11' fill='#dc2626'>finance enters the</text>"
A "<text x='1100' y='$((Cy 10)+9)' text-anchor='end' font-size='11' fill='#dc2626'>weekly loss numbers</text>"
A "<text x='932' y='$((RT 7)+40)' text-anchor='end' font-size='11' fill='#7c3aed'>monthly rule changes</text>"
A "<text x='932' y='$((RT 7)+55)' text-anchor='end' font-size='11' fill='#7c3aed'>(Gemini proposes,</text>"
A "<text x='932' y='$((RT 7)+70)' text-anchor='end' font-size='11' fill='#7c3aed'>Raghav + Deepa approve)</text>"
# boxes
for($i=0;$i -lt $rows.Count;$i++){
 $r=$rows[$i]; $y=(RT $i)+13; $x=$cx[$r.c]-131
 A "<rect x='$x' y='$y' width='262' height='92' rx='8' fill='$($r.fill)' stroke='$($r.st)' stroke-width='2.5'/>"
 $n=$r.t.Count; $ty=$y+46-($n-1)*9+4
 for($j=0;$j -lt $n;$j++){ $line=[System.Security.SecurityElement]::Escape($r.t[$j]); A "<text x='$($cx[$r.c])' y='$($ty+18*$j)' text-anchor='middle' font-size='12.5' fill='#1f2937'>$line</text>" }
}
A "<text x='190' y='1522' font-size='12.5' fill='#374151'>Dashed arrows = data flow  |  Orange band = human gate: no PO without Raghav's approval  |  Purple = feedback loop, human-approved (rules never self-edit)  |  A generated PO counts as stock on order until marked received  |  Shadow mode for the first 4 weeks</text>"
A "</svg>"
$sb.ToString() | Set-Content -Encoding utf8 "$out\demand_planning_components_map_v5.svg"
"written"
