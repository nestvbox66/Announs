import { ResolvedValue } from "./VariableResolver";

function toNumber(value: ResolvedValue): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const num = parseFloat(value);
    return Number.isNaN(num) ? NaN : num;
  }
  return NaN;
}

export class OperatorEvaluator {
  evaluate(left: ResolvedValue, operator: string, right: ResolvedValue): boolean {
    switch (operator) {
      case "==":
        return left === right;
      case "!=":
        return left !== right;
      case ">":
        return toNumber(left) > toNumber(right);
      case ">=":
        return toNumber(left) >= toNumber(right);
      case "<":
        return toNumber(left) < toNumber(right);
      case "<=":
        return toNumber(left) <= toNumber(right);
      default:
        throw new Error(`Unsupported operator: ${operator}`);
    }
  }
}
