import { RegistradorTarifaFinal } from '../aplicacion/puertos';

/** Valor por defecto (REGISTRO_TARIFA=ninguno): no avisa a M7. Lo usan los tests y el desarrollo local. */
export class RegistradorTarifaNinguno implements RegistradorTarifaFinal {
  async registrar(): Promise<void> {
    // Sin M7 configurado no hay nada que hacer.
  }
}
