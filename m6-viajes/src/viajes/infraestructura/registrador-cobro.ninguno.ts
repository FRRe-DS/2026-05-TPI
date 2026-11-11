import { RegistradorCobro } from '../aplicacion/puertos';

/** Valor por defecto (REGISTRO_TARIFA=ninguno): no avisa a M7. Lo usan los tests y el desarrollo local. */
export class RegistradorCobroNinguno implements RegistradorCobro {
  async viajeCompletado(): Promise<void> {
    // Sin M7 configurado no hay nada que hacer.
  }

  async cargoCancelacion(): Promise<void> {
    // Sin M7 configurado no hay nada que hacer.
  }
}
