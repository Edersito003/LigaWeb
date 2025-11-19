import pandas as pd
import itertools
import numpy as np

# --- 1. Leer CSV actualizado ---
df = pd.read_csv("liga_actualizada.csv", sep=';')

equipos = df['Equipo'].tolist()
partidos_por_jugar = df['Partidos_por_Jugar'].iloc[0]  # 34 total

# --- 2. Crear lista de partidos pendientes ---
partidos_pendientes = []
for equipo1, equipo2 in itertools.combinations(equipos, 2):
    # Consideramos doble vuelta
    for local, visitante in [(equipo1, equipo2), (equipo2, equipo1)]:
        # Chequear si el partido ya fue jugado
        jugados_local = df.loc[df['Equipo']==local, 'Partidos_Jugados'].values[0]
        jugados_visit = df.loc[df['Equipo']==visitante, 'Partidos_Jugados'].values[0]
        if jugados_local < partidos_por_jugar and jugados_visit < partidos_por_jugar:
            partidos_pendientes.append((local, visitante))

# --- 3. Función para simular partido ---
def simular_partido(local_stats, visitante_stats):
    # Promedios de goles
    media_local = local_stats['AVG_Goles_Marcados'] * (local_stats['ELO_Rating']/100)
    media_visitante = visitante_stats['AVG_Goles_Marcados'] * (visitante_stats['ELO_Rating']/100)

    # Ajuste home advantage
    media_local *= 1.1

    goles_local = np.random.poisson(media_local)
    goles_visit = np.random.poisson(media_visitante)

    return goles_local, goles_visit

# --- 4. Simular todos los partidos pendientes ---
puntos = df.set_index('Equipo')['Puntos'].to_dict()

for local, visitante in partidos_pendientes:
    local_stats = df.loc[df['Equipo']==local].iloc[0]
    visitante_stats = df.loc[df['Equipo']==visitante].iloc[0]

    goles_local, goles_visit = simular_partido(local_stats, visitante_stats)

    if goles_local > goles_visit:
        puntos[local] += 3
    elif goles_local < goles_visit:
        puntos[visitante] += 3
    else:
        puntos[local] += 1
        puntos[visitante] += 1

# --- 5. Crear tabla final estimada ---
tabla_final = pd.DataFrame.from_dict(puntos, orient='index', columns=['Puntos'])
tabla_final = tabla_final.sort_values(by='Puntos', ascending=False).reset_index()
tabla_final.rename(columns={'index':'Equipo'}, inplace=True)
tabla_final.index += 1

print("===== CLASIFICACIÓN ESTIMADA (final) =====")
for i, row in tabla_final.iterrows():
    print(f"{i}|{row['Equipo']}|{row['Puntos']}")
