# Guía de Diseño y Construcción del Scenario Designer

## Arquitectura de configuración narrativa para Announs

**Proyecto:** Announs / MSFS Announcement System  
**Componente:** Backoffice administrativo + Desktop Announs  
**Objetivo:** Diseñar y construir la herramienta para definir, configurar y administrar escenarios narrativos de anuncios y posteriormente integrar dicha configuración con el Desktop.



# 1. Propósito de esta etapa

El sistema Announs ya dispone de:

- catálogo de eventos;

- eventos narrativos;

- configuración de eventos;

- switches de ejecución;

- generación de anuncios;

- selección de audio Pack / IA;

- prompts;

- voces;

- perfiles de audio;

- configuración por usuario;

- configuración por vuelo;

- arquitectura narrativa en el Desktop.

El Backoffice administrativo ya permite administrar gran parte de la parametría existente.

El siguiente gran componente será una herramienta destinada a **diseñar la narrativa de un vuelo**.

Esta herramienta permitirá definir:

- qué eventos forman parte de un escenario;

- en qué orden pueden ejecutarse;

- bajo qué condiciones;

- en qué fase del vuelo;

- qué eventos son obligatorios u opcionales;

- qué eventos pueden depender de otros;

- qué comportamiento tiene cada evento;

- qué parámetros intervienen;

- qué configuración debe consumir el Desktop.

El objetivo final no es simplemente crear una pantalla de ABM.

El objetivo es construir un **motor de definición de escenarios narrativos**, cuya configuración sea administrable desde el Backoffice y consumible de manera determinística por el Desktop.



# 2. Nombre conceptual

Durante el diseño evitar utilizar “Editor de Eventos” como nombre arquitectónico principal.

Los eventos ya existen como entidades independientes.

El nuevo componente debe conceptualizarse como:

**Scenario Designer**

o, alternativamente:

**Narrative Designer**

Para la documentación técnica se recomienda utilizar:

**Scenario Designer**

y reservar:

- **Event** → unidad individual del catálogo.

- **Scenario** → conjunto organizado de eventos y reglas.

- **Scenario Designer** → herramienta para definir y administrar escenarios.

- **Narrative Engine** → componente runtime que ejecuta el escenario.

- **Narrative Orchestrator** → componente runtime que coordina la ejecución.



# 3. Situación arquitectónica actual

La arquitectura narrativa existente en el Desktop debe considerarse la base de ejecución.

El flujo conceptual actual es:

EventCatalog  
      ↓  
ScenarioFactory  
      ↓  
Scenario  
      ↓  
NarrativeEngine  
      ↓  
NarrativeOrchestrator  
      ↓  
Scheduler  
      ↓  
Dispatcher  
      ↓  
Handler  
      ↓  
AnnouncementQueue  
      ↓  
AnnouncementPlayer / AnnouncementService

No reconstruir esta arquitectura.

El Scenario Designer debe generar/configurar información que esta arquitectura pueda consumir.

La nueva herramienta es, principalmente, una **capa de definición/configuración**.



# 4. Separación fundamental: definición vs ejecución

Esta distinción debe mantenerse durante todo el diseño.

## Diseño / Backoffice

El Backoffice define:

Scenario  
 ├── metadata  
 ├── phases  
 ├── steps  
 ├── events  
 ├── conditions  
 ├── ordering  
 ├── dependencies  
 └── parameters

## Runtime / Desktop

El Desktop interpreta:

Flight  
   ↓  
Scenario  
   ↓  
Current Phase  
   ↓  
Eligible Events  
   ↓  
Conditions  
   ↓  
Event  
   ↓  
Handler  
   ↓  
Announcement

El Backoffice **no debe ejecutar la narrativa**.

El Desktop **no debe permitir modificar la definición estructural del escenario**.



# 5. Objetivo funcional del Scenario Designer

El diseñador deberá permitir construir visualmente un escenario narrativo.

Como mínimo deberá poder representar:

Scenario  
│  
├── Phase  
│   ├── Step  
│   │   ├── Event  
│   │   ├── Condition  
│   │   └── Parameters  
│   │  
│   └── Step  
│  
├── Phase  
│   ├── Step  
│   └── Step  
│  
└── Phase

Ejemplo conceptual:

SCENARIO: Standard Commercial Flight  
  
PRE-FLIGHT  
 ├── Crew Welcome  
 ├── Crew Basic Information  
 ├── Captain Welcome  
 └── Captain Basic Information  
  
TAXI  
 ├── Arm Doors  
 ├── Dim Lights  
 └── Safety Brief  
  
TAKEOFF  
 └── Prepare for Takeoff  
  
CLIMB  
 └── Upcoming Service  
  
CRUISE  
 ├── General Information  
 ├── Customs Forms  
 └── Service Information  
  
DESCENT  
 ├── 10,000 Feet  
 ├── Close Descent  
 └── Upcoming Actions  
  
LANDING  
 └── Landing Announcement  
  
TAXI TO GATE  
 ├── Welcome  
 └── Remaining Seated  
  
AT GATE  
 ├── Disarm Doors  
 └── Deboarding

Esto es solamente un ejemplo conceptual.

No asumir que esta estructura debe quedar hardcodeada.



# 6. Event Catalog vs Scenario

Debe existir una separación clara.

## Event Catalog

Representa:

“Qué eventos conoce el sistema.”

Por ejemplo:

preflight\_crew\_welcome  
preflight\_crew\_basic\_info  
preflight\_capt\_welcome  
taxi\_capt\_armdoors  
cruise\_capt\_general\_info  
...

Cada evento puede tener metadata como:

- event key;

- display name;

- phase;

- role;

- enabledSwitch;

- descripción;

- tipo;

- parámetros;

- prompt;

- audio;

- etc.

## Scenario

Representa:

“Qué eventos utilizamos, cómo los organizamos y bajo qué condiciones.”

Por ejemplo:

Scenario A  
 ├── preflight\_crew\_welcome  
 ├── preflight\_capt\_welcome  
 ├── taxi\_capt\_armdoors  
 └── cruise\_capt\_general\_info

El mismo evento podría eventualmente pertenecer a varios escenarios.

Por lo tanto:

**Event ≠ Scenario Step**



# 7. Scenario Step

El concepto de ScenarioStep será central.

Un Step representa la utilización de un evento dentro de un escenario.

Conceptualmente:

ScenarioStep  
 ├── event  
 ├── order  
 ├── phase  
 ├── enabled  
 ├── conditions  
 ├── dependencies  
 ├── timing  
 └── parameters

Esto permite que el catálogo permanezca estable mientras que la configuración narrativa pueda evolucionar.



# 8. Fases

El escenario debería organizarse conceptualmente por fases del vuelo.

Inicialmente considerar las fases que ya utiliza Announs:

- Gate

- Pre-flight

- Taxi

- Takeoff

- Climb

- Cruise

- Descent

- Landing

- Taxi to Gate

- At Gate

No crear todavía una nueva tabla únicamente para fases si el modelo existente permite resolverlo.

Primero analizar si la fase ya está representada correctamente en:

- Event Catalog;

- ScenarioDefinition;

- EventDefinition;

- código actual.

Solo crear una nueva entidad persistente si el diseñador realmente necesita que las fases sean configurables.



# 9. Orden de ejecución

El diseñador deberá poder expresar orden.

Ejemplo:

1. Crew Welcome  
2. Crew Basic Information  
3. Captain Welcome  
4. Captain Basic Information

Pero no asumir que todos los eventos deben formar una lista lineal.

El diseño debe permitir evolucionar hacia:

Event A  
   ↓  
Event B  
   ↓  
      ┌── Event C  
      │  
      └── Event D

Esto será importante cuando aparezcan:

- condiciones;

- alternativas;

- eventos opcionales;

- eventos dependientes;

- reglas específicas de vuelo.



# 10. Conditions

El Scenario Designer deberá eventualmente permitir condiciones.

Ejemplos conceptuales:

IF aircraft.family = Airbus  
    execute event A

IF flight.duration \> 120  
    execute service announcement

IF eventConfig\[eventKey\] != "off"  
    event is eligible

IF phase = cruise  
    evaluate cruise rules

No implementar todavía un lenguaje de expresiones complejo sin necesidad.

Primero identificar qué condiciones ya soporta el RuleEngine existente.

El Scenario Designer debe **configurar reglas que el runtime ya pueda interpretar**, en lugar de crear un segundo motor de reglas.



# 11. Switches existentes

Los switches de configuración ya fueron integrados correctamente al runtime.

Los valores existentes son:

"off"  
"pack"  
"IA"

Semántica:

off  → evento deshabilitado  
pack → evento habilitado utilizando Pack  
IA   → evento habilitado utilizando IA

El Scenario Designer no debe duplicar esta lógica.

Debe respetar la configuración existente.

La arquitectura debe distinguir:

### Disponibilidad estructural

¿El evento forma parte del escenario?

### Configuración operacional

¿El usuario tiene el evento habilitado?

Estas son dos cosas diferentes.

Ejemplo:

Scenario  
  └── preflight\_capt\_welcome  
          ↓  
eventConfig  
  └── preflight\_capt\_welcome = "off"

El evento pertenece al escenario, pero no se ejecuta.



# 12. Flight-specific configuration

Actualmente existe:

flight\_setting\_announcements

Debe mantenerse como parte de la configuración específica de un vuelo.

No reemplazar esta entidad automáticamente por el Scenario Designer.

Primero determinar:

- qué configuración pertenece al escenario;

- qué configuración pertenece al usuario;

- qué configuración pertenece al vuelo;

- qué configuración pertenece al runtime.

Modelo conceptual:

SYSTEM  
   ↓  
Scenario Definition  
   ↓  
User Configuration  
   ↓  
Flight Configuration  
   ↓  
Runtime Context

El sistema debe tener reglas claras de precedencia.



# 13. Precedencia de configuración

Antes de implementar nuevas tablas, documentar la precedencia.

Por ejemplo:

System Defaults  
      ↓  
Scenario Configuration  
      ↓  
User Configuration  
      ↓  
Flight Configuration  
      ↓  
Runtime Context

No implementar todavía una precedencia nueva si no existe una necesidad concreta.

Primero documentarla y validar cómo encaja con el comportamiento actual.



# 14. Diseño visual propuesto

La herramienta debería evitar parecer un ABM tradicional.

Se recomienda una interfaz de tipo:

┌─────────────────────────────────────────────────────┐  
│ Scenario Designer                                   │  
│                                                     │  
│ Scenario: Standard Commercial Flight               │  
├───────────────┬─────────────────────────────────────┤  
│               │                                     │  
│ PHASES        │        SCENARIO CANVAS              │  
│               │                                     │  
│ ● Pre-flight  │  ┌─────────────────────────────┐    │  
│ ○ Taxi        │  │ Crew Welcome                │    │  
│ ○ Takeoff     │  │ preflight\_crew\_welcome      │    │  
│ ○ Cruise      │  └─────────────────────────────┘    │  
│ ○ Descent     │                ↓                    │  
│ ○ Landing     │  ┌─────────────────────────────┐    │  
│               │  │ Captain Welcome             │    │  
│               │  │ preflight\_capt\_welcome      │    │  
│               │  └─────────────────────────────┘    │  
│               │                ↓                    │  
│               │  ┌─────────────────────────────┐    │  
│               │  │ Basic Information           │    │  
│               │  └─────────────────────────────┘    │  
│               │                                     │  
└───────────────┴─────────────────────────────────────┘

Pero no implementar un canvas drag-and-drop complejo en la primera versión.

La primera versión puede utilizar:

- fases;

- lista ordenable;

- selector de eventos;

- panel de propiedades;

- condiciones básicas.

La representación visual puede evolucionar después.



# 15. Panel de propiedades

Al seleccionar un Step debería aparecer:

Event  
--------------------------------  
Display Name  
Event Key  
Phase  
Role  
  
Execution  
--------------------------------  
Enabled  
Priority  
Order  
  
Conditions  
--------------------------------  
Condition 1  
Condition 2  
  
Audio  
--------------------------------  
Source  
Pack / IA  
  
Prompt  
--------------------------------  
Master Prompt  
Prompt  
  
Dependencies  
--------------------------------  
Requires  
Blocks

Los campos que no existan todavía no deben inventarse en la base de datos.

El panel puede mostrar inicialmente solamente la metadata disponible.



# 16. Versionado

El Scenario Designer debería diseñarse desde el principio considerando que la configuración puede evolucionar.

Ejemplo:

Scenario: Standard Flight  
  
Version 1  
Version 2  
Version 3

Pero **no implementar todavía versionado persistente si no existe una necesidad inmediata**.

Sí diseñar el modelo conceptual para que posteriormente sea posible.

Una futura versión podría permitir:

Draft  
   ↓  
Validate  
   ↓  
Publish  
   ↓  
Active

Esto será especialmente importante cuando existan usuarios reales utilizando distintos escenarios.



# 17. Draft vs Published

Una eventual evolución debería separar:

Draft configuration

de:

Published configuration

El Desktop debería consumir exclusivamente una configuración publicada.

El diseñador podría permitir modificar un Draft sin afectar vuelos en ejecución.

Nuevamente:

**diseñar conceptualmente ahora; implementar solamente cuando sea necesario.**



# 18. Integración con el Desktop

Este es uno de los puntos más importantes.

El Desktop no debería consultar directamente cada detalle de la interfaz del Backoffice.

Debe consumir una representación estable de la configuración.

Conceptualmente:

Backoffice  
   ↓  
Scenario Definition  
   ↓  
Published Configuration  
   ↓  
Desktop  
   ↓  
ScenarioFactory  
   ↓  
Scenario  
   ↓  
NarrativeEngine



# 19. Contrato entre Backoffice y Desktop

Antes de implementar la integración debe definirse un contrato.

Por ejemplo:

**interface** ScenarioDefinition \{  
    id: string;  
    key: string;  
    name: string;  
    version: number;  
    phases: ScenarioPhase\[\];  
\}

Y:

**interface** ScenarioPhase \{  
    key: string;  
    name: string;  
    order: number;  
    steps: ScenarioStep\[\];  
\}

Y:

**interface** ScenarioStep \{  
    id: string;  
    eventKey: string;  
    order: number;  
    enabled: boolean;  
    conditions?: ScenarioCondition\[\];  
\}

Esto es conceptual.

No asumir que estos tipos deben copiarse literalmente al código existente.

El contrato definitivo debe derivarse de:

- modelo actual;

- ScenarioDefinition;

- NarrativeStep;

- EventDefinition;

- EventCatalog;

- ScenarioFactory.



# 20. No duplicar el Event Catalog

Una regla arquitectónica fundamental:

El Scenario Designer no debe convertirse en un segundo catálogo de eventos.

El catálogo debe seguir siendo la fuente de verdad de:

eventKey  
displayName  
metadata  
handler  
phase  
enabledSwitch

El Scenario Designer debe referenciar eventos.

Conceptualmente:

ScenarioStep.eventKey  
          ↓  
EventCatalog  
          ↓  
EventDefinition

No duplicar:

displayName  
handler  
prompt  
audio

si esos datos ya pertenecen al catálogo o a otras entidades.



# 21. Persistencia

Antes de crear nuevas tablas realizar una auditoría específica.

Revisar:

- events

- announces\_catalog

- flight\_setting\_announcements

- setting\_announcements

- master\_prompts

- prompts

- audio\_raw

- audio\_final

- cualquier entidad actualmente relacionada con escenarios.

El objetivo es determinar:

¿Qué parte del Scenario Designer puede construirse utilizando el modelo existente?

Solo después identificar las entidades que realmente faltan.

No hacer una reingeniería de la base de datos.



# 22. Posibles entidades futuras

Solo como modelo conceptual, podrían eventualmente aparecer:

scenarios  
scenario\_versions  
scenario\_phases  
scenario\_steps  
scenario\_conditions  
scenario\_step\_dependencies

Pero estas entidades son **hipótesis de diseño**, no una instrucción para crearlas inmediatamente.

La primera tarea será verificar si realmente son necesarias.



# 23. Validación del escenario

El Designer debería poder validar una configuración antes de publicarla.

Validaciones futuras:

### Eventos

- eventKey existente;

- evento activo;

- handler disponible.

### Orden

- órdenes duplicados;

- steps huérfanos;

- ciclos de dependencia.

### Fases

- phase válida;

- orden válido.

### Condiciones

- condición válida;

- campos existentes;

- operadores compatibles.

### Recursos

- prompt existente;

- audio existente;

- voz compatible.

El objetivo será que un administrador no pueda publicar una configuración inconsistente.



# 24. Preview

Una característica futura muy valiosa será:

**Preview Scenario**

Permitiría recorrer:

Phase 1  
   ↓  
Event 1  
   ↓  
Event 2  
   ↓  
Event 3

sin ejecutar necesariamente audio real.

Posteriormente podría evolucionar a:

**Test Scenario**

utilizando un FlightContext simulado.

Esto permitiría detectar problemas antes de llevar la configuración al Desktop.



# 25. Integración con FlightContext

El Desktop ya posee:

FlightContext

y actualmente contiene:

settings.eventConfig

El escenario debería terminar resolviéndose contra el contexto del vuelo.

Conceptualmente:

Scenario  
      +  
FlightContext  
      +  
eventConfig  
      +  
Flight data  
      ↓  
NarrativeOrchestrator

Esto es fundamental porque un mismo escenario puede comportarse diferente según:

- aerolínea;

- avión;

- duración;

- idioma;

- configuración del usuario;

- configuración del vuelo;

- eventos habilitados.



# 26. No mover lógica de runtime al Backoffice

El Backoffice debe definir.

El Desktop debe ejecutar.

No trasladar al Backoffice:

- timers;

- listeners de MSFS;

- detección de fases;

- lógica de reproducción;

- manejo de cola;

- generación de audio;

- resolución de FlightContext;

- interacción con el simulador.

El Designer configura reglas.

El Desktop interpreta esas reglas.



# 27. Estrategia de implementación

Se recomienda dividir el trabajo en etapas.

## Etapa SD-01 — Auditoría

Documentar:

- arquitectura narrativa actual;

- EventCatalog;

- ScenarioDefinition;

- NarrativeStep;

- ScenarioFactory;

- Scheduler;

- Dispatcher;

- Handler;

- RuleEngine;

- FlightContext;

- eventConfig.

No modificar código.



## Etapa SD-02 — Modelo conceptual

Definir:

- Scenario;

- Phase;

- Step;

- Event;

- Condition;

- Dependency;

- Parameters.

No modificar DB todavía.



## Etapa SD-03 — Gap analysis de DB

Comparar el modelo conceptual contra las tablas existentes.

Determinar:

- qué existe;

- qué puede reutilizarse;

- qué falta;

- qué debería persistirse.

No crear tablas automáticamente.



## Etapa SD-04 — Diseño UX

Diseñar:

- lista de escenarios;

- editor;

- fases;

- steps;

- panel de propiedades;

- orden;

- validaciones.



## Etapa SD-05 — Persistencia

Solo después de aprobar el modelo:

- crear/modificar tablas necesarias;

- policies RLS;

- relaciones;

- índices.



## Etapa SD-06 — Scenario Designer MVP

Construir:

- crear escenario;

- editar escenario;

- seleccionar eventos;

- ordenar eventos;

- organizar fases;

- guardar configuración;

- validar configuración.



## Etapa SD-07 — Contrato Desktop

Definir exactamente:

Backoffice → Published Scenario → Desktop

Crear tipos compartidos o contrato equivalente.



## Etapa SD-08 — Desktop Integration

Modificar progresivamente:

ScenarioFactory  
NarrativeEngine  
NarrativeOrchestrator  
Scheduler  
Dispatcher

para consumir configuración externa.

No reemplazar todo de una vez.



## Etapa SD-09 — Compatibility Layer

Durante la transición, mantener un fallback:

Published Scenario  
      ↓  
si existe → utilizarlo  
      ↓  
si no existe → comportamiento actual

Esto permitirá probar la nueva configuración sin romper el Desktop.



## Etapa SD-10 — Activación

Cuando la nueva configuración esté validada:

Legacy hardcoded configuration  
             ↓  
      Published Scenario  
             ↓  
       Runtime Desktop

Eliminación del comportamiento hardcodeado únicamente después de verificar que el nuevo mecanismo funciona.



# 28. Backoffice: ubicación funcional

El Scenario Designer debe ubicarse conceptualmente dentro de:

**Escenarios**

y no dentro de:

**Configuración**

La separación sería:

Configuración  
 ├── System Settings  
 ├── Voices Stock  
 ├── Languages  
 ├── Voice Languages  
 ├── Accents  
 ├── Voice Capabilities  
 └── Audio Profiles  
  
Escenarios  
 ├── Scenarios  
 ├── Events  
 ├── Announces Catalog  
 ├── Master Prompts  
 ├── Audio Raw  
 ├── Prompts  
 └── Audio Final

Posteriormente:

Escenarios  
 ├── Scenario Designer  
 ├── Events  
 ├── Announces Catalog  
 ├── Master Prompts  
 ├── Audio Raw  
 ├── Prompts  
 └── Audio Final



# 29. Seguridad

El Scenario Designer será una funcionalidad administrativa.

Debe quedar protegido por:

Supabase Auth  
      ↓  
app\_metadata.role  
      ↓  
public.is\_admin()  
      ↓  
RLS

No confiar únicamente en:

ocultar menú  
ocultar botón

El frontend controla UX.

RLS controla seguridad.



# 30. Principios que deben mantenerse

### 1. No reingeniería innecesaria

No modificar tablas existentes sin una necesidad concreta.

### 2. No duplicar información

El catálogo define eventos.

El escenario los referencia.

### 3. No duplicar lógica

El Backoffice configura.

El Desktop ejecuta.

### 4. No romper el runtime existente

La integración será progresiva.

### 5. Configuración publicada

El Desktop debe consumir una configuración estable.

### 6. Compatibilidad

Debe existir una transición segura desde el comportamiento actual.

### 7. Seguridad real

Toda operación administrativa debe estar protegida por RLS.

### 8. Evolución

El diseño debe permitir posteriormente:

- múltiples escenarios;

- versionado;

- drafts;

- publicación;

- condiciones;

- dependencias;

- templates;

- preview;

- testing.



# 31. Primera tarea concreta

La primera acción no debe ser programar.

Debe ser ejecutar una:

**Etapa SD-01 — Auditoría de la arquitectura narrativa actual.**

La auditoría debe producir un documento que responda:

1. ¿Dónde se define actualmente un Scenario?

2. ¿Dónde se define un NarrativeStep?

3. ¿Cómo se seleccionan los eventos?

4. ¿Cómo se determina el orden?

5. ¿Dónde se evalúan las condiciones?

6. ¿Qué hace actualmente Scheduler?

7. ¿Qué hace NarrativeOrchestrator?

8. ¿Qué hace Dispatcher?

9. ¿Qué hace EventCatalogService?

10. ¿Cómo se consulta eventConfig?

11. ¿Cómo se utiliza enabledSwitch?

12. ¿Qué información proviene de FlightContext?

13. ¿Qué partes están hardcodeadas?

14. ¿Qué partes ya son configurables?

15. ¿Qué partes podrían ser alimentadas desde una configuración persistida?

16. ¿Qué entidades de la DB podrían reutilizarse?

17. ¿Qué información necesariamente requeriría nuevas entidades?

La auditoría debe ser **read-only**.

No modificar:

- Desktop;

- Backoffice;

- DB;

- Storage;

- EventCatalog;

- ScenarioFactory;

- NarrativeEngine;

- NarrativeOrchestrator;

- Scheduler;

- Dispatcher;

- Handlers.



# 32. Resultado esperado de SD-01

El documento final deberá incluir:

A. Arquitectura actual  
B. Flujo de ejecución  
C. Modelo conceptual existente  
D. Información hardcodeada  
E. Información configurable  
F. Dependencias  
G. Persistencia existente  
H. Gaps  
I. Propuesta de arquitectura futura  
J. Riesgos  
K. Plan de migración

Especialmente deberá diferenciar claramente:

**LO QUE EXISTE HOY**

de:

**LO QUE PROPONEMOS CONSTRUIR**

No realizar modificaciones durante esta etapa.



# 33. Criterio de éxito

Esta etapa será exitosa si, al finalizar, podemos responder con precisión:

“¿Qué necesita saber el Desktop para ejecutar un escenario narrativo y dónde debería vivir cada uno de esos datos?”

Y también:

“¿Qué necesita administrar el Scenario Designer para producir esa configuración?”

La respuesta a esas dos preguntas será el contrato conceptual entre:

Backoffice  
     ↕  
Scenario Definition  
     ↕  
Desktop

A partir de allí se podrá diseñar la persistencia y comenzar la implementación sin improvisar la arquitectura.
