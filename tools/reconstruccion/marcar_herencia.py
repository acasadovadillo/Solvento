#!/usr/bin/env python3
"""
Marca como «Herencia» las operaciones de inversión anteriores a la apertura de
su cuenta.

Una compra fechada antes de que la cuenta existiera no pudo pagarse con dinero
de esa cuenta. Dejarla como Compra resta su coste de una caja que entonces era
cero, y eso es exactamente lo que hacía que Bankinter apareciese en −28.000 €.
Como Herencia, la posición y su coste siguen contando en la cartera —la
rentabilidad no cambia— pero deja de restar un efectivo que nunca salió de ahí.

    python3 marcar_herencia.py <entrada.json> <salida.json> <Cuenta> <dd/mm/aaaa apertura>
"""
import sys, re, json, datetime


def fecha(s):
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", str(s or ""))
    return datetime.date(int(m.group(3)), int(m.group(2)), int(m.group(1))) if m else None


def main():
    entrada, salida, cuenta, apertura_txt = sys.argv[1:5]
    apertura = fecha(apertura_txt)
    doc = json.load(open(entrada))
    tocadas = []
    for r in doc.get("inversiones", []):
        if str(r.get("cuenta") or "").strip() != cuenta:
            continue
        if (r.get("tipo_movimiento") or "Compra") != "Compra":
            continue
        f = fecha(r.get("fecha"))
        if not f or f >= apertura:
            continue
        r["tipo_movimiento"] = "Herencia"
        tocadas.append((f, r.get("nombre", ""), float(str(r.get("coste") or 0).replace(",", "."))))
    json.dump(doc, open(salida, "w"), ensure_ascii=False, indent=2)
    print(f"«{cuenta}» abrió el {apertura:%d/%m/%Y}; operaciones anteriores marcadas como Herencia:")
    for f, n, c in tocadas:
        print(f"   {f:%d/%m/%Y}  {n[:38]:38} {c:>11,.2f} €".replace(",", " "))
    print(f"   total que deja de restar de la caja: {sum(c for _, _, c in tocadas):,.2f} €".replace(",", " "))


if __name__ == "__main__":
    main()
