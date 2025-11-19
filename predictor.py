"""
predictor.py

- Lee:
  - clasificacion.txt  (sep='|', formato que me diste)
  - enfrentamientos.csv (matriz; filas = locales, columnas = visitantes; celdas 'g-h' ó vacías)
  - datos_equipo.csv (con columna 'Equipo' y 'ELO' y otros campos opcionales)

- Mantiene los partidos ya jugados (no los vuelve a simular).
- Simula los partidos pendientes (Monte Carlo interno por partido).
- Actualiza la clasificación empezando desde la clasificación actual.
- Escribe prediccion.txt con los partidos predichos y la clasificación final estimada.

Uso:
    python3 predictor.py
"""

import pandas as pd
import numpy as np
import re
from collections import Counter
import random
import math
from pathlib import Path

# -----------------------
# Configuración
# -----------------------
MC_SAMPLES_PER_MATCH = 300   # Monte Carlo por partido para estimar probabilidades
HOME_ADV = 0.20              # ventaja de local (ajuste multiplicativo sobre exp goles)
BASE_GOALS = 1.25            # goles esperados base por equipo
SEED = 42
random.seed(SEED)
np.random.seed(SEED)

# -----------------------
# Helpers
# -----------------------
def read_clasificacion(path="clasificacion.txt"):
    df = pd.read_csv(path, sep="|", header=None, engine="python")
    df.columns = ["pos","team","pts","pj","v","e","d","gf","gc","dg","pct","form"]
    # limpiar espacios
    df["team"] = df["team"].astype(str).str.strip()
    # asegurar tipos numéricos donde corresponde
    for c in ["pos","pts","pj","v","e","d","gf","gc","dg"]:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0).astype(int)
    df["form"] = df["form"].astype(str).str.strip()
    return df

def read_datos_equipos(path="datos_equipo.csv"):
    if not Path(path).exists():
        # generar dataframe mínimo si no existe (para evitar crash); el usuario debe proveer
        return pd.DataFrame(columns=["Equipo","ELO"])
    df = pd.read_csv(path)
    df["Equipo"] = df["Equipo"].astype(str).str.strip()
    return df

def read_h2h_matrix(path="enfrentamientos.csv"):
    # lee como tabla con index en la primera columna
    df = pd.read_csv(path, sep=";", index_col=0, dtype=str, engine="python")
    # normalizar: strip
    df.index = [str(x).strip() for x in df.index]
    df.columns = [str(x).strip() for x in df.columns]
    df = df.fillna("").astype(str)
    return df

def normalize_name(s):
    # returns uppercase alphanumeric only
    return re.sub(r'[^A-Z0-9]', '', str(s).upper())

def build_name_mapping(h2h_index, teams_full):
    """
    Intenta mapear abreviaturas del H2H (filas/cols) a nombres completos de teams_full.
    Estrategia:
      1) Si exact match (ignoring case/space) -> map
      2) Si abreviatura es substring normalizado del nombre completo -> map
      3) Si primeras 3 letras coinciden -> map
      4) fallback: intentar buscar con prefijo
    Devuelve dict: code -> full_name
    """
    mapping = {}
    full_norms = {team: normalize_name(team) for team in teams_full}
    used_full = set()
    for code in h2h_index:
        cnorm = normalize_name(code)
        found = None
        # exact normalized match
        for full, fnorm in full_norms.items():
            if cnorm == fnorm:
                found = full; break
        if not found:
            # substring
            for full, fnorm in full_norms.items():
                if cnorm and cnorm in fnorm:
                    found = full; break
        if not found:
            # startswith first 3 chars
            for full, fnorm in full_norms.items():
                if fnorm.startswith(cnorm[:3]) or cnorm.startswith(fnorm[:3]):
                    found = full; break
        if not found:
            # try case-insensitive includes of shortened code in full
            for full in teams_full:
                if code.lower() in full.lower().replace(" ", ""):
                    found = full; break
        if found and found not in used_full:
            mapping[code] = found
            used_full.add(found)
        else:
            # leave unmapped for now; will try more aggressive later
            mapping[code] = None
    # second pass: map remaining None by best fuzzy by prefix
    for code, val in mapping.items():
        if val is None:
            cnorm = normalize_name(code)
            best = None
            bestscore = -1
            for full in teams_full:
                fnorm = normalize_name(full)
                # score by longest common substring prefix
                common = 0
                for i in range(1, min(len(cnorm), len(fnorm))+1):
                    if fnorm.startswith(cnorm[:i]):
                        common = i
                if common > bestscore:
                    bestscore = common; best = full
            if best:
                mapping[code] = best
    return mapping

def parse_score_cell(cell):
    # espera 'g-h' o 'g-h ' etc. devuelve (g,h) ints, o None si vacío o no parseable
    cell = str(cell).strip()
    if not cell: return None
    m = re.search(r'(\d+)\s*[-:]\s*(\d+)', cell)
    if not m: return None
    return (int(m.group(1)), int(m.group(2)))

# -----------------------
# Fuerza del equipo (ELO ajustado + forma + historial)
# -----------------------
def compute_strengths(clasif_df, datos_df):
    # ELO: si falta, asignar 1500
    elo_map = {}
    for _, r in datos_df.iterrows():
        elo_map[r["Equipo"]] = float(r.get("ELO", 1500))
    # ensure every clasif team has an elo
    for t in clasif_df["team"]:
        if t not in elo_map:
            elo_map[t] = 1500.0
    elos = np.array([elo_map[t] for t in clasif_df["team"]], dtype=float)
    # normalizar eló
    elo_norm = (elos - elos.min()) / (elos.max() - elos.min() + 1e-9)

    # forma: convertir 'V E D' -> score 0..1 (V=1,E=0.5,D=0)
    def form_score(s):
        s = str(s).strip()
        if not s:
            return 0.5
        parts = re.split(r'\s+', s)
        score = 0.0
        for x in parts[-5:]:
            if x.upper().startswith('V'): score += 1.0
            elif x.upper().startswith('E'): score += 0.5
            else: score += 0.0
        return score / 5.0
    form_scores = np.array([form_score(x) for x in clasif_df["form"]], dtype=float)
    # historial: usa columnas de datos_df si existen (Anios_En_Primera, Titulos_Primera etc.)
    hist_score = []
    for t in clasif_df["team"]:
        row = datos_df[datos_df["Equipo"]==t]
        if not row.empty:
            r = row.iloc[0]
            val = 0.0
            for col, w in [("Anios_En_Primera", 0.5), ("Titulos_Primera", 1.0), ("Titulos_Segunda", 0.5), ("Titulos_Tercera", 0.2)]:
                if col in r:
                    try:
                        val += float(r[col]) * w
                    except:
                        pass
            hist_score.append(val)
        else:
            hist_score.append(0.0)
    hist_arr = np.array(hist_score, dtype=float)
    if hist_arr.max() - hist_arr.min() > 1e-9:
        hist_norm = (hist_arr - hist_arr.min()) / (hist_arr.max() - hist_arr.min())
    else:
        hist_norm = np.zeros_like(hist_arr)

    # combinación (pesos ajustables)
    strengths = {}
    for i, t in enumerate(clasif_df["team"]):
        F = 0.60 * elo_norm[i] + 0.30 * form_scores[i] + 0.10 * hist_norm[i]
        strengths[t] = max(0.01, float(F))
    return strengths

# -----------------------
# Probabilidades y simulación por partido
# -----------------------
def expected_goals_for_match(strength_home, strength_away):
    # transformar fuerza 0..1 -> expected goals
    # formula simple: base + factor*(sh - sa) + home advantage
    diff = strength_home - strength_away
    e_home = BASE_GOALS + diff * 0.9 + HOME_ADV
    e_away = BASE_GOALS - diff * 0.9
    # asegurar positivos
    e_home = max(0.1, e_home)
    e_away = max(0.1, e_away)
    return e_home, e_away

def simulate_scores(eh, ea, samples=MC_SAMPLES_PER_MATCH):
    # simula muchos partidos con Poisson y devuelve distribuciones
    scores = []
    for _ in range(samples):
        gh = np.random.poisson(eh)
        ga = np.random.poisson(ea)
        scores.append((int(gh), int(ga)))
    return scores

def score_stats_from_sim(scores):
    # scores: list of (gh,ga)
    c = Counter(scores)
    most_common_score, cnt = c.most_common(1)[0]
    total = len(scores)
    win_h = sum(1 for (g,h) in scores if g > h)  # careful: order (gh,ga) -> g>h means home wins
    win_h = sum(1 for (gh,ga) in scores if gh > ga)
    draw = sum(1 for (gh,ga) in scores if gh == ga)
    win_a = sum(1 for (gh,ga) in scores if gh < ga)
    return {
        "mode_score": most_common_score,
        "p_home": win_h/total,
        "p_draw": draw/total,
        "p_away": win_a/total
    }

# -----------------------
# Aplicar simulación sólo a pendientes y actualizar tabla
# -----------------------
def run_prediction(clasif_df, h2h_df, datos_df, out_path="prediccion.txt"):
    teams_full = list(clasif_df["team"])
    # build mapping for h2h codes -> full names
    codes = list(h2h_df.index)
    mapping = build_name_mapping(codes, teams_full)

    # create reverse mapping for columns if different order
    # assume columns are same codes as index or similar
    colcodes = list(h2h_df.columns)
    colmap = build_name_mapping(colcodes, teams_full)

    # compute strengths
    strengths = compute_strengths(clasif_df, datos_df)

    # prepare output lines
    out_lines = []
    out_lines.append("PREDICCION - partidos pendientes (simulados):\n")

    # We'll update a working table based on given classification (so already-played matches are not reapplied)
    table = clasif_df.set_index("team")[["pts","pj","v","e","d","gf","gc","dg"]].copy()
    table = table.astype(int)

    # iterate over matrix cells: rows = local codes, cols = visitor codes
    for loc_code in h2h_df.index:
        for vis_code in h2h_df.columns:
            cell = h2h_df.at[loc_code, vis_code]
            parsed = parse_score_cell(cell)
            # resolve team names using mapping
            home = mapping.get(loc_code) or mapping.get(loc_code, loc_code)
            away = colmap.get(vis_code) or colmap.get(vis_code, vis_code)

            # If mapping produced same code strings, try find by name direct (in case code equals full)
            if home not in table.index and loc_code in table.index:
                home = loc_code
            if away not in table.index and vis_code in table.index:
                away = vis_code

            # if still not in table, try to find approximate (rare)
            if home not in table.index:
                # attempt best match by normalized prefix
                cand = None
                for t in table.index:
                    if normalize_name(loc_code) in normalize_name(t) or normalize_name(t) in normalize_name(loc_code):
                        cand = t; break
                if cand: home = cand
            if away not in table.index:
                cand = None
                for t in table.index:
                    if normalize_name(vis_code) in normalize_name(t) or normalize_name(t) in normalize_name(vis_code):
                        cand = t; break
                if cand: away = cand

            # Skip self-match or missing mapping
            if home == away:
                continue
            if home not in table.index or away not in table.index:
                # unable to map teams -> log and skip
                out_lines.append(f"# SKIP mapping failed for cell {loc_code} vs {vis_code} -> home:{home} away:{away}\n")
                continue

            if parsed:
                # partido ya jugado: lo dejamos tal cual (no modificar tabla)
                # But ensure classification already contains it; we do NOT reapply results.
                continue
            else:
                # pendiente -> hay que simular
                sh = strengths.get(home, 0.5)
                sa = strengths.get(away, 0.5)
                eh, ea = expected_goals_for_match(sh, sa)
                sims = simulate_scores(eh, ea, samples=MC_SAMPLES_PER_MATCH)
                stats = score_stats_from_sim(sims)
                mode_score = stats["mode_score"]
                gh, ga = mode_score

                # Escribir linea informativa
                out_lines.append(f"{home} vs {away}  -> predicted {gh}-{ga}   (P_home={stats['p_home']:.2f}  P_draw={stats['p_draw']:.2f}  P_away={stats['p_away']:.2f})\n")

                # aplicar resultado a tabla (sumar solo lo simulado)
                table.at[home, "pj"] += 1
                table.at[away, "pj"] += 1
                table.at[home, "gf"] += gh
                table.at[home, "gc"] += ga
                table.at[away, "gf"] += ga
                table.at[away, "gc"] += gh
                table.at[home, "dg"] = table.at[home, "gf"] - table.at[home, "gc"]
                table.at[away, "dg"] = table.at[away, "gf"] - table.at[away, "gc"]

                if gh > ga:
                    table.at[home, "v"] += 1
                    table.at[away, "d"] += 1
                    table.at[home, "pts"] += 3
                elif ga > gh:
                    table.at[away, "v"] += 1
                    table.at[home, "d"] += 1
                    table.at[away, "pts"] += 3
                else:
                    table.at[home, "e"] += 1
                    table.at[away, "e"] += 1
                    table.at[home, "pts"] += 1
                    table.at[away, "pts"] += 1

    # una vez simulados todos, ordenar clasificación final
    table["dg"] = table["gf"] - table["gc"]
    clasif_final = table.sort_values(by=["pts","dg","gf"], ascending=[False, False, False])

    out_lines.append("\n===== CLASIFICACIÓN ESTIMADA (final) =====\n")
    rank = 1
    for team, row in clasif_final.iterrows():
        out_lines.append(f"{rank}|{team}|{int(row['pts'])}\n")
        rank += 1

    # guardar prediccion.txt
    with open(out_path, "w", encoding="utf-8") as f:
        f.writelines(out_lines)

    print(f"Predicción generada y guardada en: {out_path}")
    return out_lines, clasif_final

# -----------------------
# Main
# -----------------------
if __name__ == "__main__":
    print("Leyendo archivos...")
    clas = read_clasificacion("clasificacion.txt")
    datos = read_datos_equipos("datos_equipo.csv")
    h2h = read_h2h_matrix("enfrentamientos.csv")

    print("Equipos en clasificación:", len(clas))
    print("Filas H2H:", len(h2h.index), "Cols H2H:", len(h2h.columns))

    out_lines, clasif_final = run_prediction(clas, h2h, datos, out_path="prediccion.txt")
    print("Hecho.")
