'use strict';

/**
 * Catálogo geográfico de Paraguay: 17 departamentos + Asunción (Distrito
 * Capital), con sus distritos.
 *
 * Se usa para sembrar las tablas `departamentos` y `ciudades`. Vive como
 * módulo de datos —y no embebido en la migración— para poder revisarlo,
 * corregirlo y volver a aplicarlo sin reescribir la migración: el seed es
 * idempotente (ON CONFLICT DO NOTHING), así que agregar distritos faltantes
 * es volver a correrlo.
 *
 * OJO: esta lista debe contrastarse contra la división política oficial
 * (INE/DGEEC). Un distrito faltante no rompe nada —la ciudad sigue pudiendo
 * escribirse a mano y la tarifa funciona igual— pero no va a poder elegirse
 * desde el selector del asistente hasta que se agregue acá.
 */

const DEPARTAMENTOS = [
  {
    nombre: 'Asunción',
    ciudades: ['Asunción'],
  },
  {
    nombre: 'Central',
    ciudades: [
      'Areguá', 'Capiatá', 'Fernando de la Mora', 'Guarambaré', 'Itá', 'Itauguá',
      'Julián Augusto Saldívar', 'Lambaré', 'Limpio', 'Luque', 'Mariano Roque Alonso',
      'Nueva Italia', 'Ñemby', 'San Antonio', 'San Lorenzo', 'Villa Elisa', 'Villeta',
      'Ypacaraí', 'Ypané',
    ],
  },
  {
    nombre: 'Alto Paraná',
    ciudades: [
      'Ciudad del Este', 'Doctor Juan León Mallorquín', 'Doctor Raúl Peña', 'Hernandarias',
      'Iruña', 'Itakyry', 'Juan E. O\'Leary', 'Los Cedrales', 'Mbaracayú', 'Minga Guazú',
      'Minga Porá', 'Naranjal', 'Ñacunday', 'Presidente Franco', 'San Alberto',
      'San Cristóbal', 'Santa Rita', 'Santa Rosa del Monday', 'Tavapy', 'Yguazú',
    ],
  },
  {
    nombre: 'Itapúa',
    ciudades: [
      'Encarnación', 'Alto Verá', 'Bella Vista', 'Cambyretá', 'Capitán Meza',
      'Capitán Miranda', 'Carlos Antonio López', 'Carmen del Paraná', 'Coronel Bogado',
      'Edelira', 'Fram', 'General Artigas', 'General Delgado', 'Hohenau', 'Itapúa Poty',
      'Jesús', 'José Leandro Oviedo', 'La Paz', 'Mayor Otaño', 'Natalio', 'Nueva Alborada',
      'Obligado', 'Pirapó', 'San Cosme y Damián', 'San Juan del Paraná',
      'San Pedro del Paraná', 'San Rafael del Paraná', 'Tomás Romero Pereira', 'Trinidad',
      'Yatytay',
    ],
  },
  {
    nombre: 'Caaguazú',
    ciudades: [
      'Coronel Oviedo', 'Caaguazú', 'Carayaó', 'Doctor Cecilio Báez',
      'Doctor J. Eulogio Estigarribia', 'Doctor Juan Manuel Frutos', 'José Domingo Ocampos',
      'La Pastora', 'Mariscal Francisco Solano López', 'Nueva Londres', 'Nueva Toledo',
      'R.I. 3 Corrales', 'Raúl Arsenio Oviedo', 'Repatriación', 'San José de los Arroyos',
      'Santa Rosa del Mbutuy', 'Simón Bolívar', 'Tembiaporá', 'Tres de Febrero',
      'Vaquería', 'Yhú',
    ],
  },
  {
    nombre: 'San Pedro',
    ciudades: [
      'San Pedro de Ycuamandiyú', 'Antequera', 'Capiibary', 'Choré',
      'General Elizardo Aquino', 'General Isidoro Resquín', 'Guayaibí',
      'Itacurubí del Rosario', 'Liberación', 'Lima', 'Nueva Germania',
      'San Estanislao', 'San Pablo', 'San Vicente Pancholo', 'Santa Rosa del Aguaray',
      'Tacuatí', 'Unión', 'Veinticinco de Diciembre', 'Villa del Rosario',
      'Yataity del Norte', 'Yrybucuá',
    ],
  },
  {
    nombre: 'Cordillera',
    ciudades: [
      'Caacupé', 'Altos', 'Arroyos y Esteros', 'Atyrá', 'Caraguatay', 'Emboscada',
      'Eusebio Ayala', 'Isla Pucú', 'Itacurubí de la Cordillera', 'Juan de Mena',
      'Loma Grande', 'Mbocayaty del Yhaguy', 'Nueva Colombia', 'Piribebuy',
      'Primero de Marzo', 'San Bernardino', 'San José Obrero', 'Santa Elena', 'Tobatí',
      'Valenzuela', 'Vapor Cue',
    ],
  },
  {
    nombre: 'Guairá',
    ciudades: [
      'Villarrica', 'Borja', 'Capitán Mauricio José Troche', 'Coronel Martínez',
      'Doctor Bottrell', 'Félix Pérez Cardozo', 'General Eugenio A. Garay',
      'Independencia', 'Itapé', 'Iturbe', 'José Fassardi', 'Mbocayaty',
      'Natalicio Talavera', 'Ñumí', 'Paso Yobái', 'San Salvador', 'Tebicuary', 'Yataity',
    ],
  },
  {
    nombre: 'Caazapá',
    ciudades: [
      'Caazapá', 'Abaí', 'Buena Vista', 'Doctor Moisés Bertoni', 'Fulgencio Yegros',
      'General Higinio Morínigo', 'Maciel', 'San Juan Nepomuceno', 'Tavaí',
      'Tres de Mayo', 'Yuty',
    ],
  },
  {
    nombre: 'Paraguarí',
    ciudades: [
      'Paraguarí', 'Acahay', 'Caapucú', 'Carapeguá', 'Escobar',
      'General Bernardino Caballero', 'La Colmena', 'María Antonia', 'Mbuyapey',
      'Pirayú', 'Quiindy', 'Quyquyhó', 'San Roque González de Santa Cruz', 'Sapucai',
      'Tebicuarymí', 'Yaguarón', 'Ybycuí', 'Ybytymí',
    ],
  },
  {
    nombre: 'Misiones',
    ciudades: [
      'San Juan Bautista', 'Ayolas', 'San Ignacio', 'San Miguel', 'San Patricio',
      'Santa María', 'Santa Rosa', 'Santiago', 'Villa Florida', 'Yabebyry',
    ],
  },
  {
    nombre: 'Ñeembucú',
    ciudades: [
      'Pilar', 'Alberdi', 'Cerrito', 'Desmochados', 'General José Eduvigis Díaz',
      'Guazú Cuá', 'Humaitá', 'Isla Umbú', 'Laureles', 'Mayor José D. Martínez',
      'Paso de Patria', 'San Juan Bautista del Ñeembucú', 'Tacuaras', 'Villa Franca',
      'Villa Oliva', 'Villalbín',
    ],
  },
  {
    nombre: 'Concepción',
    ciudades: [
      'Concepción', 'Arroyito', 'Azotey', 'Belén', 'Horqueta', 'Loreto',
      'Paso Barreto', 'San Alfredo', 'San Carlos del Apa', 'San Lázaro',
      'Sargento José Félix López', 'Yby Yaú',
    ],
  },
  {
    nombre: 'Amambay',
    ciudades: [
      'Pedro Juan Caballero', 'Bella Vista Norte', 'Capitán Bado', 'Karapaí', 'Zanja Pytá',
    ],
  },
  {
    nombre: 'Canindeyú',
    ciudades: [
      'Salto del Guairá', 'Corpus Christi', 'Curuguaty', 'Itanará', 'Katueté',
      'La Paloma del Espíritu Santo', 'Maracaná', 'Nueva Esperanza', 'Puerto Adela',
      'Villa Ygatimí', 'Yasy Cañy', 'Yby Pytá', 'Ypejhú',
    ],
  },
  {
    nombre: 'Presidente Hayes',
    ciudades: [
      'Villa Hayes', 'Benjamín Aceval', 'Doctor José Falcón', 'José Falcón',
      'Nanawa', 'Puerto Pinasco', 'Teniente Esteban Martínez',
      'Teniente Irala Fernández', 'Pozo Colorado',
    ],
  },
  {
    nombre: 'Boquerón',
    ciudades: ['Filadelfia', 'Loma Plata', 'Mariscal Estigarribia', 'Neuland'],
  },
  {
    nombre: 'Alto Paraguay',
    ciudades: ['Fuerte Olimpo', 'Bahía Negra', 'Carmelo Peralta', 'Puerto Casado'],
  },
];

/**
 * Misma normalización que TarifaDeliveryService.normalizarTexto. Se duplica
 * acá a propósito: este módulo tiene que poder usarse desde una migración,
 * donde importar services acopla el esquema al código de aplicación.
 */
function normalizar(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

module.exports = { DEPARTAMENTOS, normalizar, PAIS: { codigo: 'PY', nombre: 'Paraguay' } };
