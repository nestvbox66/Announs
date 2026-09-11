/**
 * Resultado estándar que devuelven los servicios del sistema.
 * Sigue el patrón `ServiceResult<T>` usado por los servicios de datos.
 */
export interface ServiceResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

export function ok<T>(data: T): ServiceResult<T> {
  return { success: true, data };
}

export function okVoid(): ServiceResult<void> {
  return { success: true };
}

export function fail<T = void>(error: string): ServiceResult<T> {
  return { success: false, error };
}
