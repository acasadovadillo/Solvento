set -e
P=/usr/local/Caskroom/miniconda/base/bin/python3
T=tools/reconstruccion
D=/Users/albertocasadovadillo/Downloads/Solvento_EXPORT
DL=/Users/albertocasadovadillo/Downloads
CON="Santander,Bankinter,Trade Republic,MyInvestor"
$P $T/generar_cuenta.py "$DL/SANTANDER_DATOS/transactions_2026-09-08T11_48_14.889Z.xls" \
   "$D/solvento-SIN-PULLTEST.json" "Santander" "Efectivo" "$D/_1.json" "$CON" > /tmp/p1.log
$P $T/generar_cuenta.py "$DL/BANKINTER_DATOS" "$D/_1.json" "Bankinter" "Efectivo" "$D/_2.json" "$CON" > /tmp/p2.log
$P $T/tarjeta_bankinter.py "$DL/BANKINTER_DATOS" "$D/_2.json" "$D/_3.json" > /tmp/p3.log
$P $T/marcar_herencia.py "$D/_3.json" "$D/_4.json" "Bankinter" "16/06/2025" > /tmp/p4.log
$P $T/generar_tr.py "$DL/TRADEREPUBLIC_DATOS/Extracto de cuenta.pdf" "$D/_4.json" "$D/_5.json" > /tmp/p5.log
$P $T/generar_myinvestor.py "$DL/MYINVESTOR_DATOS/Movimientos_08-09-2025_08-09-2026.xlsx" \
   "$D/_5.json" "$D/_6.json" > /tmp/p7.log
$P $T/emparejar_traspasos.py "$D/_6.json" "$D/_7.json" 14 > /tmp/p6.log
$P $T/limpiar_ajustes.py "$D/_7.json" "$D/solvento-RECONSTRUIDO.json" > /tmp/p8.log
grep -hE "CUADRE|✓ cuadra|parejas resueltas|ambiguas" /tmp/p1.log /tmp/p2.log /tmp/p3.log /tmp/p5.log /tmp/p7.log /tmp/p6.log /tmp/p8.log
