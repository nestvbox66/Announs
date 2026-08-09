import { FlightContext } from "../services/FlightContext";
import { VariableResolver, ResolvedValue } from "./VariableResolver";

export class ExpressionContext {
  constructor(
    private readonly flightContext: FlightContext,
    private readonly variableResolver: VariableResolver
  ) {}

  get(name: string): ResolvedValue {
    return this.variableResolver.resolve(name, this.flightContext);
  }
}
