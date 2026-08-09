import { FlightContext } from "../services/FlightContext";

export type ResolvedValue = number | boolean | string | null;

type ResolverFn = (context: FlightContext) => ResolvedValue;

const SPECIAL_VARIABLES: Record<string, ResolverFn> = {
  phase: (context) => context.getFSM().currentState,
};

export class VariableResolver {
  resolve(name: string, context: FlightContext): ResolvedValue {
    const special = SPECIAL_VARIABLES[name];
    if (special) {
      return special(context);
    }
    const value = context.getTelemetry()[name];
    return value === undefined ? null : (value as ResolvedValue);
  }
}
