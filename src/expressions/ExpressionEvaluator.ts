import { FlightContext } from "../services/FlightContext";
import { ExpressionContext } from "./ExpressionContext";
import { OperatorEvaluator } from "./OperatorEvaluator";
import { VariableResolver, ResolvedValue } from "./VariableResolver";

export interface ExpressionEvaluator {
  evaluate(expression: string, context: FlightContext): boolean;
}

const OPERATORS = [">=", "<=", "==", "!=", ">", "<"];

interface ParsedOperand {
  value: ResolvedValue;
  isVariable: boolean;
}

function parseOperand(token: string): ParsedOperand {
  const trimmed = token.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return { value: trimmed.slice(1, -1), isVariable: false };
  }
  if (trimmed === "true") return { value: true, isVariable: false };
  if (trimmed === "false") return { value: false, isVariable: false };
  const number = Number(trimmed);
  if (trimmed !== "" && !Number.isNaN(number)) {
    return { value: number, isVariable: false };
  }
  return { value: trimmed, isVariable: true };
}

export class SimpleExpressionEvaluator implements ExpressionEvaluator {
  private readonly variableResolver = new VariableResolver();
  private readonly operatorEvaluator = new OperatorEvaluator();

  evaluate(expression: string, flightContext: FlightContext): boolean {
    const expr = expression.trim();
    const operator = OPERATORS.find((op) => expr.includes(op));
    if (!operator) {
      throw new Error(`Unsupported expression (no operator found): ${expression}`);
    }
    const parts = expr.split(operator);
    if (parts.length !== 2) {
      throw new Error(`Malformed expression: ${expression}`);
    }

    const left = parseOperand(parts[0]);
    const right = parseOperand(parts[1]);

    const expressionContext = new ExpressionContext(flightContext, this.variableResolver);
    const leftValue = left.isVariable ? expressionContext.get(left.value as string) : left.value;
    const rightValue = right.isVariable ? expressionContext.get(right.value as string) : right.value;

    console.log("[EXPRESSION]");
    console.log(expr);
    console.log("↓");
    if (left.isVariable) {
      console.log(`${left.value} = ${leftValue}`);
    } else {
      console.log(`${leftValue}`);
    }
    console.log("↓");

    const result = this.operatorEvaluator.evaluate(leftValue, operator, rightValue);
    console.log(result ? "TRUE" : "FALSE");
    return result;
  }
}
