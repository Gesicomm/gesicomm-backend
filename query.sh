#!/bin/bash
docker exec gesicomm-postgres psql -U gesicomm -d gesicomm -c "SELECT id, fecha, quiere_factura, ruc, estado FROM envios WHERE quiere_factura = true;"
