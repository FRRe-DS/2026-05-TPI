-- Tipo de vehículo `AUTO` / `MOTO` en lugar de `CAR` / `MOTORCYCLE`, igual que el contrato del
-- Grupo 12 (M6 compartido) y que M2, M3, M4, M8 y M9. Sólo cambian los valores: no se pierden datos.

-- Los eventos pendientes de la bandeja llevan `vehicleType` con el valor viejo. Hay que dejar que se
-- publiquen antes de migrar; si no, saldrían con el contrato anterior.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM eventos_salientes WHERE publicado_en IS NULL) THEN
        RAISE EXCEPTION 'Hay eventos pendientes en eventos_salientes: esperá a que se publiquen antes de migrar (005)';
    END IF;
END $$;

ALTER TABLE viajes DROP CONSTRAINT viajes_tipo_vehiculo_check;

UPDATE viajes SET tipo_vehiculo = 'AUTO' WHERE tipo_vehiculo = 'CAR';
UPDATE viajes SET tipo_vehiculo = 'MOTO' WHERE tipo_vehiculo = 'MOTORCYCLE';

ALTER TABLE viajes
    ADD CONSTRAINT viajes_tipo_vehiculo_check CHECK (tipo_vehiculo IN ('AUTO', 'MOTO'));
