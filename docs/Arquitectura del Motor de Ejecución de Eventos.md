Arquitectura del Motor de Ejecución de Eventos

# Objetivo

El motor de ejecución de eventos tiene como responsabilidad coordinar la generación automática de anuncios durante el desarrollo de un vuelo, desacoplando completamente:

- la lógica operacional del vuelo, 

- la definición narrativa, 

- la evaluación de reglas, 

- la reproducción de anuncios, 

- y la integración con simuladores de vuelo. 

La arquitectura fue diseñada bajo el principio de **responsabilidad única**, permitiendo extender el sistema mediante configuración y nuevos componentes, sin modificar el núcleo del motor.


# Arquitectura general

                    **Flight Simulator**

**                     (MSFS / XPlane / ...)**

**                            │**

**                            ▼**

**                   Flight Controller**

**                            │**

**                            ▼**

**                      Flight Context**

**                            │**

**                            ▼**

**                        Flight FSM**

**                            │**

**                            ▼**

**                        Scheduler**

**                            │**

**             ┌──────────────┴──────────────┐**

**             ▼                             ▼**

**      Flight Scenario             (Futuro)**

**                              Operational Situation**

**             │**

**             ▼**

**      Scenario Definition**

**             │**

**             ▼**

**       Narrative Steps**

**             │**

**             ▼**

**        Event Catalog**

**             │**

**             ▼**

**         Rule Engine**

**             │**

**             ▼**

**     Trigger Evaluators**

**             │**

**             ▼**

**      Event Dispatcher**

**             │**

**             ▼**

**    Announcement Queue**

**             │**

**             ▼**

**   Announcement Player**

**             │**

**             ▼**

** Edge Function (AI / TTS)**

**             │**

**             ▼**

**	Audio**


# Responsabilidades 

## Flight Controller

Responsable de traducir la información proveniente del simulador de vuelo (SimConnect, X-Plane SDK, Aerofly SDK, etc.) hacia un modelo interno independiente del proveedor.

No contiene reglas narrativas.

No genera anuncios.

Su única responsabilidad es mantener actualizado el estado operacional del vuelo.


## Flight Context

Representa el estado actual del vuelo.

Centraliza toda la información utilizada por el motor.

Ejemplo:

- datos del vuelo 

- idiomas 

- voces 

- configuración 

- telemetría 

- estado del FlightFSM 

No contiene lógica.


## Flight FSM

Representa la fase operacional del vuelo.

Ejemplo:

- PRE\_BOARDING 

- BOARDING 

- TAXI 

- TAKEOFF 

- CLIMB 

- CRUISE 

- DESCENT 

- ARRIVAL 

El FSM no dispara anuncios.

Únicamente comunica cambios de fase al Scheduler.


## Scheduler

Es el orquestador principal del sistema.

No conoce anuncios específicos.

No conoce reglas particulares.

Su responsabilidad consiste en:

- activar el Flight Scenario correspondiente, 

- coordinar temporizadores, 

- coordinar situaciones operacionales (futuro), 

- iniciar el proceso de evaluación.


## Flight Scenario

Representa el flujo narrativo nominal correspondiente a una fase del vuelo.

Ejemplo:

- BoardingScenario 

- TaxiScenario 

- CruiseScenario 

Un Flight Scenario no ejecuta anuncios.

No contiene reglas.

Su responsabilidad consiste únicamente en exponer una Scenario Definition.


## Scenario Definition

Describe la narrativa correspondiente a un escenario.

Ejemplo:

BOARDING

↓

Crew Welcome

↓

Crew Basic Info

↓

Captain Welcome

↓

Captain Basic Info


No contiene:

- reglas 

- timers 

- evaluaciones 

- lógica 

Representa únicamente el orden narrativo.


## Event Catalog

Constituye el catálogo maestro de eventos del sistema.

Cada evento define:

- identidad 

- perfil 

- prioridad 

- tipo de contenido 

- trigger 

- restricciones 

- evaluador 

- productor 

- variables 

- comportamiento 

No contiene lógica de ejecución.



## Rule Engine

Determina cuándo corresponde ejecutar un evento.

No conoce simuladores.

No conoce audio.

No conoce la interfaz gráfica.

Su responsabilidad consiste únicamente en evaluar reglas.


## Trigger Evaluators 

Cada tipo de trigger posee un evaluador independiente.

Ejemplos:

- ManualTriggerEvaluator 

- TimerTriggerEvaluator 

- PhaseEnterTriggerEvaluator 

- ConditionTriggerEvaluator 

Esto permite incorporar nuevos mecanismos de disparo sin modificar el Rule Engine.


## Event Dispatcher

Implementa el patrón Event Bus.

Recibe eventos ya aprobados por el Rule Engine y los distribuye hacia uno o más destinos.

Actualmente existe un único destino:

AnnouncementEventHandler.

En el futuro podrán agregarse:

- Analytics 

- Logging 

- Cabina virtual 

- IFE 

- Plugins 

- WebSocket 

- etc.


## Announcement Queue

Serializa la reproducción de anuncios.

Garantiza que nunca existan dos anuncios reproduciéndose simultáneamente.

Administra prioridades, cancelaciones y futuras políticas de interrupción.



## Announcement Player

Responsable exclusivo de reproducir un anuncio.

Obtiene el audio mediante la Edge Function.

No conoce reglas.

No conoce escenarios.

No conoce el Scheduler.


# Principios arquitectónicos

La arquitectura fue diseñada siguiendo los siguientes principios:

- Responsabilidad única. 

- Alto desacoplamiento. 

- Extensibilidad mediante composición. 

- Configuración antes que programación. 

- Independencia respecto del simulador. 

- Independencia respecto del proveedor de IA. 

- Independencia respecto del proveedor TTS.


# Evolución prevista

La siguiente etapa de la arquitectura incorporará un nuevo concepto:

## Operational Situation

Mientras que un Flight Scenario representa el flujo narrativo normal del vuelo, una Operational Situation representa condiciones transversales que pueden aparecer en cualquier fase.

Ejemplos:

- Departure Delay 

- Seat Belt 

- Turbulence 

- Holding 

- Medical Event 

- Go Around 

- Diversion 

Estas situaciones coexistirán con el Flight Scenario activo y podrán generar eventos adicionales sin alterar el flujo nominal.


# Estado actual de implementación (5/8/2026)


| **Componente** | **Estado** |
| :-: | :-: |
| Flight Context | ✅ Implementado |
| Flight FSM | ✅ Implementado |
| Scheduler | ✅ Implementado |
| Flight Scenario | ✅ Implementado |
| Scenario Definition | ✅ Implementado |
| Event Catalog | ✅ Implementado |
| Rule Engine | ✅ Implementado |
| Trigger Evaluators | ✅ Implementado |
| Flight Expression Engine | ✅ Implementado |
| Event Dispatcher | ✅ Implementado |
| Announcement Queue | ✅ Implementado |
| Announcement Player | ✅ Implementado |
| Operational Situation | ⏳ Pendiente |
| Situation Manager | ⏳ Pendiente |
| Flight Controller (MSFS) | ⏳ Pendiente |


