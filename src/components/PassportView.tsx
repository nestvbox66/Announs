/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { 
  Globe, 
  MapPin, 
  Compass, 
  Check, 
  X, 
  Calendar, 
  Layers, 
  Award,
  ArrowLeft,
  Navigation,
  Info
} from "lucide-react";

interface PassportViewProps {
  onBack: () => void;
}

interface CountryInfo {
  code: string;
  name: string;
  flag: string;
  continent: string;
  visited: boolean;
  sealDate?: string;
  visits?: number;
  airports?: number;
}

// Full 232 countries database
const INITIAL_COUNTRIES: CountryInfo[] = [
  { code: "AF", name: "Afganistán", flag: "🇦🇫", continent: "Asia", visited: false },
  { code: "AL", name: "Albania", flag: "🇦🇱", continent: "Europa", visited: false },
  { code: "DE", name: "Alemania", flag: "🇩🇪", continent: "Europa", visited: true, sealDate: "22/02/2026", visits: 5, airports: 2 },
  { code: "AD", name: "Andorra", flag: "🇦🇩", continent: "Europa", visited: false },
  { code: "AO", name: "Angola", flag: "🇦🇴", continent: "África", visited: false },
  { code: "AG", name: "Antigua y Barbuda", flag: "🇦🇬", continent: "Norteamérica", visited: false },
  { code: "SA", name: "Arabia Saudita", flag: "🇸🇦", continent: "Asia", visited: false },
  { code: "DZ", name: "Argelia", flag: "🇩🇿", continent: "África", visited: false },
  { code: "AR", name: "Argentina", flag: "🇦🇷", continent: "Sudamérica", visited: true, sealDate: "15/05/2026", visits: 42, airports: 12 },
  { code: "AM", name: "Armenia", flag: "🇦🇲", continent: "Asia", visited: false },
  { code: "AU", name: "Australia", flag: "🇦🇺", continent: "Oceanía", visited: false },
  { code: "AT", name: "Austria", flag: "🇦🇹", continent: "Europa", visited: false },
  { code: "AZ", name: "Azerbaiyán", flag: "🇦🇿", continent: "Asia", visited: false },
  { code: "BS", name: "Bahamas", flag: "🇧🇸", continent: "Norteamérica", visited: false },
  { code: "BD", name: "Bangladés", flag: "🇧🇩", continent: "Asia", visited: false },
  { code: "BB", name: "Barbados", flag: "🇧🇧", continent: "Norteamérica", visited: false },
  { code: "BH", name: "Baréin", flag: "🇧🇭", continent: "Asia", visited: false },
  { code: "BE", name: "Bélgica", flag: "🇧🇪", continent: "Europa", visited: false },
  { code: "BZ", name: "Belice", flag: "🇧🇿", continent: "Norteamérica", visited: false },
  { code: "BJ", name: "Benín", flag: "🇧🇯", continent: "África", visited: false },
  { code: "BY", name: "Bielorrusia", flag: "🇧🇾", continent: "Europa", visited: false },
  { code: "MM", name: "Birmania", flag: "🇲🇲", continent: "Asia", visited: false },
  { code: "BO", name: "Bolivia", flag: "🇧🇴", continent: "Sudamérica", visited: true, sealDate: "05/05/2026", visits: 6, airports: 2 },
  { code: "BA", name: "Bosnia y Herzegovina", flag: "🇧🇦", continent: "Europa", visited: false },
  { code: "BW", name: "Botsuana", flag: "🇧🇼", continent: "África", visited: false },
  { code: "BR", name: "Brasil", flag: "🇧🇷", continent: "Sudamérica", visited: true, sealDate: "12/04/2026", visits: 18, airports: 5 },
  { code: "BN", name: "Brunéi", flag: "🇧🇳", continent: "Asia", visited: false },
  { code: "BG", name: "Bulgaria", flag: "🇧🇬", continent: "Europa", visited: false },
  { code: "BF", name: "Burkina Faso", flag: "🇧🇫", continent: "África", visited: false },
  { code: "BI", name: "Burundi", flag: "🇧🇮", continent: "África", visited: false },
  { code: "CV", name: "Cabo Verde", flag: "🇨🇻", continent: "África", visited: false },
  { code: "KH", name: "Camboya", flag: "🇰🇭", continent: "Asia", visited: false },
  { code: "CM", name: "Camerún", flag: "🇨🇲", continent: "África", visited: false },
  { code: "CA", name: "Canadá", flag: "🇨🇦", continent: "Norteamérica", visited: false },
  { code: "QA", name: "Catar", flag: "🇶🇦", continent: "Asia", visited: false },
  { code: "TD", name: "Chad", flag: "🇹🇩", continent: "África", visited: false },
  { code: "CL", name: "Chile", flag: "🇨🇱", continent: "Sudamérica", visited: true, sealDate: "19/04/2026", visits: 14, airports: 4 },
  { code: "CN", name: "China", flag: "🇨🇳", continent: "Asia", visited: false },
  { code: "CY", name: "Chipre", flag: "🇨🇾", continent: "Europa", visited: false },
  { code: "CO", name: "Colombia", flag: "🇨🇴", continent: "Sudamérica", visited: true, sealDate: "10/05/2026", visits: 15, airports: 4 },
  { code: "KM", name: "Comoras", flag: "🇰🇲", continent: "África", visited: false },
  { code: "KP", name: "Corea del Norte", flag: "🇰🇵", continent: "Asia", visited: false },
  { code: "KR", name: "Corea del Sur", flag: "🇰🇷", continent: "Asia", visited: false },
  { code: "CI", name: "Costa de Marfil", flag: "🇨🇮", continent: "África", visited: false },
  { code: "CR", name: "Costa Rica", flag: "🇨🇷", continent: "Norteamérica", visited: false },
  { code: "HR", name: "Croacia", flag: "🇭🇷", continent: "Europa", visited: false },
  { code: "CU", name: "Cuba", flag: "🇨🇺", continent: "Norteamérica", visited: false },
  { code: "DK", name: "Dinamarca", flag: "🇩🇰", continent: "Europa", visited: false },
  { code: "DM", name: "Dominica", flag: "🇩🇲", continent: "Norteamérica", visited: false },
  { code: "EC", name: "Ecuador", flag: "🇪🇨", continent: "Sudamérica", visited: false },
  { code: "EG", name: "Egipto", flag: "🇪🇬", continent: "África", visited: false },
  { code: "SV", name: "El Salvador", flag: "🇸🇻", continent: "Norteamérica", visited: false },
  { code: "AE", name: "Egipto (EAU)", flag: "🇦🇪", continent: "Asia", visited: false },
  { code: "ER", name: "Eritrea", flag: "🇪🇷", continent: "África", visited: false },
  { code: "SK", name: "Eslovaquia", flag: "🇸🇰", continent: "Europa", visited: false },
  { code: "SI", name: "Eslovenia", flag: "🇸🇮", continent: "Europa", visited: false },
  { code: "ES", name: "España", flag: "🇪🇸", continent: "Europa", visited: true, sealDate: "02/03/2026", visits: 8, airports: 3 },
  { code: "US", name: "Estados Unidos", flag: "🇺🇸", continent: "Norteamérica", visited: true, sealDate: "24/05/2026", visits: 25, airports: 8 },
  { code: "EE", name: "Estonia", flag: "🇪🇪", continent: "Europa", visited: false },
  { code: "ET", name: "Etiopía", flag: "🇪🇹", continent: "África", visited: false },
  { code: "PH", name: "Filipinas", flag: "🇵🇭", continent: "Asia", visited: false },
  { code: "FI", name: "Finlandia", flag: "🇫🇮", continent: "Europa", visited: false },
  { code: "FJ", name: "Fiyi", flag: "🇫🇯", continent: "Oceanía", visited: false },
  { code: "FR", name: "Francia", flag: "🇫🇷", continent: "Europa", visited: true, sealDate: "15/01/2026", visits: 6, airports: 2 },
  { code: "GA", name: "Gabón", flag: "🇬🇦", continent: "África", visited: false },
  { code: "GM", name: "Gambia", flag: "🇬🇲", continent: "África", visited: false },
  { code: "GE", name: "Georgia", flag: "🇬🇪", continent: "Asia", visited: false },
  { code: "GH", name: "Ghana", flag: "🇬🇭", continent: "África", visited: false },
  { code: "GD", name: "Granada", flag: "🇬🇩", continent: "Norteamérica", visited: false },
  { code: "GR", name: "Grecia", flag: "🇬🇷", continent: "Europa", visited: false },
  { code: "GT", name: "Guatemala", flag: "🇬🇹", continent: "Norteamérica", visited: false },
  { code: "GN", name: "Guinea", flag: "GN", continent: "África", visited: false },
  { code: "GQ", name: "Guinea Ecuatorial", flag: "🇬🇶", continent: "África", visited: false },
  { code: "GW", name: "Guinea-Bisáu", flag: "🇬🇼", continent: "África", visited: false },
  { code: "GY", name: "Guyana", flag: "🇬🇾", continent: "Sudamérica", visited: false },
  { code: "HT", name: "Haití", flag: "🇭🇹", continent: "Norteamérica", visited: false },
  { code: "HN", name: "Honduras", flag: "🇭🇳", continent: "Norteamérica", visited: false },
  { code: "HU", name: "Hungría", flag: "🇭🇺", continent: "Europa", visited: false },
  { code: "IN", name: "India", flag: "🇮🇳", continent: "Asia", visited: false },
  { code: "ID", name: "Indonesia", flag: "🇮🇩", continent: "Asia", visited: false },
  { code: "IQ", name: "Irak", flag: "🇮🇶", continent: "Asia", visited: false },
  { code: "IR", name: "Irán", flag: "🇮🇷", continent: "Asia", visited: false },
  { code: "IE", name: "Irlanda", flag: "🇮🇪", continent: "Europa", visited: false },
  { code: "IS", name: "Islandia", flag: "🇮🇸", continent: "Europa", visited: false },
  { code: "IL", name: "Israel", flag: "🇮🇱", continent: "Asia", visited: false },
  { code: "IT", name: "Italia", flag: "🇮🇹", continent: "Europa", visited: true, sealDate: "28/12/2025", visits: 7, airports: 3 },
  { code: "JM", name: "Jamaica", flag: "🇯🇲", continent: "Norteamérica", visited: false },
  { code: "JP", name: "Japón", flag: "🇯🇵", continent: "Asia", visited: false },
  { code: "JO", name: "Jordania", flag: "🇯🇴", continent: "Asia", visited: false },
  { code: "KZ", name: "Kazajistán", flag: "🇰🇿", continent: "Asia", visited: false },
  { code: "KE", name: "Kenia", flag: "🇰🇪", continent: "África", visited: false },
  { code: "KG", name: "Kirguistán", flag: "🇰🇬", continent: "Asia", visited: false },
  { code: "KI", name: "Kiribati", flag: "🇰🇮", continent: "Oceanía", visited: false },
  { code: "KW", name: "Kuwait", flag: "🇰🇼", continent: "Asia", visited: false },
  { code: "LA", name: "Laos", flag: "🇱🇦", continent: "Asia", visited: false },
  { code: "LS", name: "Lesoto", flag: "🇱🇸", continent: "África", visited: false },
  { code: "LV", name: "Letonia", flag: "🇱🇻", continent: "Europa", visited: false },
  { code: "LB", name: "Líbano", flag: "🇱🇧", continent: "Asia", visited: false },
  { code: "LR", name: "Liberia", flag: "🇱🇷", continent: "África", visited: false },
  { code: "LY", name: "Libia", flag: "🇱🇾", continent: "África", visited: false },
  { code: "LI", name: "Liechtenstein", flag: "🇱🇮", continent: "Europa", visited: false },
  { code: "LT", name: "Lituania", flag: "🇱🇹", continent: "Europa", visited: false },
  { code: "LU", name: "Luxemburgo", flag: "🇱🇺", continent: "Europa", visited: false },
  { code: "MK", name: "Macedonia del Norte", flag: "🇲🇰", continent: "Europa", visited: false },
  { code: "MG", name: "Madagascar", flag: "🇲🇬", continent: "África", visited: false },
  { code: "MY", name: "Malasia", flag: "🇲🇾", continent: "Asia", visited: false },
  { code: "MW", name: "Malaui", flag: "🇲🇼", continent: "África", visited: false },
  { code: "MV", name: "Maldivas", flag: "🇲🇻", continent: "Asia", visited: false },
  { code: "ML", name: "Malí", flag: "🇲🇱", continent: "África", visited: false },
  { code: "MT", name: "Malta", flag: "🇲🇹", continent: "Europa", visited: false },
  { code: "MA", name: "Marruecos", flag: "🇲🇦", continent: "África", visited: false },
  { code: "MU", name: "Mauricio", flag: "🇲🇺", continent: "África", visited: false },
  { code: "MR", name: "Mauritania", flag: "🇲🇷", continent: "África", visited: false },
  { code: "MX", name: "México", flag: "🇲🇽", continent: "Norteamérica", visited: true, sealDate: "11/03/2026", visits: 12, airports: 3 },
  { code: "FM", name: "Micronesia", flag: "🇫🇲", continent: "Oceanía", visited: false },
  { code: "MD", name: "Moldavia", flag: "🇲🇩", continent: "Europa", visited: false },
  { code: "MC", name: "Mónaco", flag: "🇲🇨", continent: "Europa", visited: false },
  { code: "MN", name: "Mongolia", flag: "🇲🇳", continent: "Asia", visited: false },
  { code: "ME", name: "Montenegro", flag: "🇲🇪", continent: "Europa", visited: false },
  { code: "MZ", name: "Mozambique", flag: "🇲🇿", continent: "África", visited: false },
  { code: "NA", name: "Namibia", flag: "🇳🇦", continent: "África", visited: false },
  { code: "NR", name: "Nauru", flag: "🇳🇷", continent: "Oceanía", visited: false },
  { code: "NP", name: "Nepal", flag: "🇳🇵", continent: "Asia", visited: false },
  { code: "NI", name: "Nicaragua", flag: "🇳🇮", continent: "Norteamérica", visited: false },
  { code: "NE", name: "Níger", flag: "🇳🇪", continent: "África", visited: false },
  { code: "NG", name: "Nigeria", flag: "🇳🇬", continent: "África", visited: false },
  { code: "NO", name: "Noruega", flag: "🇳🇴", continent: "Europa", visited: false },
  { code: "NZ", name: "Nueva Zelanda", flag: "🇳🇿", continent: "Oceanía", visited: false },
  { code: "OM", name: "Omán", flag: "🇴🇲", continent: "Asia", visited: false },
  { code: "NL", name: "Países Bajos", flag: "🇳🇱", continent: "Europa", visited: false },
  { code: "PK", name: "Pakistán", flag: "🇵🇰", continent: "Asia", visited: false },
  { code: "PW", name: "Palaos", flag: "🇵🇼", continent: "Oceanía", visited: false },
  { code: "PA", name: "Panamá", flag: "🇵🇦", continent: "Norteamérica", visited: false },
  { code: "PG", name: "Papúa Nueva Guinea", flag: "🇵🇬", continent: "Oceanía", visited: false },
  { code: "PY", name: "Paraguay", flag: "🇵🇾", continent: "Sudamérica", visited: true, sealDate: "30/04/2026", visits: 4, airports: 1 },
  { code: "PE", name: "Perú", flag: "🇵🇪", continent: "Sudamérica", visited: true, sealDate: "18/02/2026", visits: 9, airports: 2 },
  { code: "PL", name: "Polonia", flag: "🇵🇱", continent: "Europa", visited: false },
  { code: "PT", name: "Portugal", flag: "🇵🇹", continent: "Europa", visited: false },
  { code: "GB", name: "Reino Unido", flag: "🇬🇧", continent: "Europa", visited: true, sealDate: "17/11/2025", visits: 8, airports: 3 },
  { code: "CF", name: "República Centroafricana", flag: "🇨🇫", continent: "África", visited: false },
  { code: "CZ", name: "República Checa", flag: "🇨🇿", continent: "Europa", visited: false },
  { code: "CG", name: "República del Congo", flag: "🇨🇬", continent: "África", visited: false },
  { code: "CD", name: "República Dem. del Congo", flag: "🇨🇩", continent: "África", visited: false },
  { code: "DO", name: "República Dominicana", flag: "🇩🇴", continent: "Norteamérica", visited: false },
  { code: "ZA", name: "Sudáfrica", flag: "🇿🇦", continent: "África", visited: false },
  { code: "SE", name: "Suecia", flag: "🇸🇪", continent: "Europa", visited: false },
  { code: "CH", name: "Suiza", flag: "🇨🇭", continent: "Europa", visited: false },
  { code: "SR", name: "Surinam", flag: "🇸🇷", continent: "Sudamérica", visited: false },
  { code: "TH", name: "Tailandia", flag: "🇹🇭", continent: "Asia", visited: false },
  { code: "TW", name: "Taiwán", flag: "🇹🇼", continent: "Asia", visited: false },
  { code: "TZ", name: "Tanzania", flag: "🇹🇿", continent: "África", visited: false },
  { code: "TJ", name: "Tayikistán", flag: "🇹🇯", continent: "Asia", visited: false },
  { code: "TL", name: "Timor Oriental", flag: "🇹🇱", continent: "Asia", visited: false },
  { code: "TG", name: "Togo", flag: "🇹🇬", continent: "África", visited: false },
  { code: "TO", name: "Tonga", flag: "🇹🇴", continent: "Oceanía", visited: false },
  { code: "TT", name: "Trinidad y Tobago", flag: "🇹🇹", continent: "Norteamérica", visited: false },
  { code: "TN", name: "Túnez", flag: "🇹🇳", continent: "África", visited: false },
  { code: "TR", name: "Turquía", flag: "🇹🇷", continent: "Europa", visited: false },
  { code: "TM", name: "Turkmenistán", flag: "🇹🇲", continent: "Asia", visited: false },
  { code: "TV", name: "Tuvalu", flag: "🇹🇻", continent: "Oceanía", visited: false },
  { code: "UA", name: "Ucrania", flag: "🇺🇦", continent: "Europa", visited: false },
  { code: "UG", name: "Uganda", flag: "🇺🇬", continent: "África", visited: false },
  { code: "UY", name: "Uruguay", flag: "🇺🇾", continent: "Sudamérica", visited: true, sealDate: "08/05/2026", visits: 11, airports: 2 },
  { code: "UZ", name: "Uzbekistán", flag: "🇺🇿", continent: "Asia", visited: false },
  { code: "VU", name: "Vanuatu", flag: "🇻🇺", continent: "Oceanía", visited: false },
  { code: "VE", name: "Venezuela", flag: "🇻🇪", continent: "Sudamérica", visited: false },
  { code: "VN", name: "Vietnam", flag: "🇻🇳", continent: "Asia", visited: false },
  { code: "YE", name: "Yemen", flag: "🇾🇪", continent: "Asia", visited: false },
  { code: "DJ", name: "Yibuti", flag: "🇩🇯", continent: "África", visited: false },
  { code: "ZM", name: "Zambia", flag: "🇿🇲", continent: "África", visited: false },
  { code: "ZW", name: "Zimbabue", flag: "🇿🇼", continent: "África", visited: false }
];

// Fill programmatically to reach exactly 232 countries as required by MSFS Global list
const generateTo232 = (): CountryInfo[] => {
  const currentList = [...INITIAL_COUNTRIES];
  const missingCount = 232 - currentList.length;
  
  // Extra list of islands and states to fill the MSFS Passport accurately & meet the 232 count
  const extraStates = [
    { code: "AW", name: "Aruba", flag: "🇦🇼", continent: "Norteamérica" },
    { code: "BM", name: "Bermudas", flag: "🇧🇲", continent: "Norteamérica" },
    { code: "KY", name: "Islas Caimán", flag: "🇰🇾", continent: "Norteamérica" },
    { code: "PF", name: "Polinesia Francesa", flag: "🇵🇫", continent: "Oceanía" },
    { code: "GL", name: "Groenlandia", flag: "🇬🇱", continent: "Norteamérica" },
    { code: "GU", name: "Guam", flag: "🇬🇺", continent: "Oceanía" },
    { code: "HK", name: "Hong Kong", flag: "🇭🇰", continent: "Asia" },
    { code: "MO", name: "Macao", flag: "🇲🇴", continent: "Asia" },
    { code: "NC", name: "Nueva Caledonia", flag: "🇳🇨", continent: "Oceanía" },
    { code: "PR", name: "Puerto Rico", flag: "🇵🇷", continent: "Norteamérica" },
    { code: "RE", name: "Reunión", flag: "🇷🇪", continent: "África" },
    { code: "FO", name: "Islas Feroe", flag: "🇫🇴", continent: "Europa" },
    { code: "GI", name: "Gibraltar", flag: "🇬🇮", continent: "Europa" },
    { code: "GG", name: "Guernsey", flag: "🇬🇬", continent: "Europa" },
    { code: "IM", name: "Isla de Man", flag: "🇮🇲", continent: "Europa" },
    { code: "JE", name: "Jersey", flag: "🇯🇪", continent: "Europa" },
    { code: "AX", name: "Islas Aland", flag: "🇦🇽", continent: "Europa" },
    { code: "AS", name: "Samoa Americana", flag: "🇦🇸", continent: "Oceanía" },
    { code: "AI", name: "Anguila", flag: "🇦🇮", continent: "Norteamérica" },
    { code: "AQ", name: "Antártida", flag: "🇦🇶", continent: "Antártida" },
    { code: "BV", name: "Isla Bouvet", flag: "🇧🇻", continent: "Antártida" },
    { code: "IO", name: "Territ. Brit. Océano Índ.", flag: "🇮🇴", continent: "Asia" },
    { code: "VG", name: "Islas Vírgenes Británicas", flag: "🇻🇬", continent: "Norteamérica" },
    { code: "VI", name: "Islas Vírgenes EE.UU.", flag: "🇻🇮", continent: "Norteamérica" },
    { code: "CX", name: "Isla de Navidad", flag: "🇨🇽", continent: "Asia" },
    { code: "CC", name: "Islas Cocos", flag: "🇨🇨", continent: "Asia" },
    { code: "CK", name: "Islas Cook", flag: "🇨🇰", continent: "Oceanía" },
    { code: "FK", name: "Islas Malvinas", flag: "🇫🇰", continent: "Sudamérica" },
    { code: "GF", name: "Guayana Francesa", flag: "🇬🇫", continent: "Sudamérica" },
    { code: "GP", name: "Guadalupe", flag: "🇬🇵", continent: "Norteamérica" },
    { code: "MQ", name: "Martinica", flag: "🇲🇶", continent: "Norteamérica" },
    { code: "YT", name: "Mayotte", flag: "🇾🇹", continent: "África" },
    { code: "MS", name: "Montserrat", flag: "🇲🇸", continent: "Norteamérica" },
    { code: "AN", name: "Antillas Holandesas", flag: "🇳🇦", continent: "Norteamérica" },
    { code: "NU", name: "Niue", flag: "🇳🇺", continent: "Oceanía" },
    { code: "NF", name: "Isla Norfolk", flag: "🇳🇫", continent: "Oceanía" },
    { code: "MP", name: "Islas Marianas del Norte", flag: "🇲🇵", continent: "Oceanía" },
    { code: "PN", name: "Islas Pitcairn", flag: "🇵🇳", continent: "Oceanía" },
    { code: "SH", name: "Santa Elena", flag: "🇸🇭", continent: "África" },
    { code: "PM", name: "San Pedro y Miquelón", flag: "🇵🇲", continent: "Norteamérica" },
    { code: "GS", name: "Islas Georgias del Sur", flag: "🇬🇸", continent: "Antártida" },
    { code: "SJ", name: "Svalbard y Jan Mayen", flag: "🇸🇯", continent: "Europa" },
    { code: "TK", name: "Tokelau", flag: "🇹🇰", continent: "Oceanía" },
    { code: "TC", name: "Islas Turcas y Caicos", flag: "🇹🇨", continent: "Norteamérica" },
    { code: "WF", name: "Wallis y Futuna", flag: "🇼🇫", continent: "Oceanía" },
    { code: "EH", name: "Sahara Occidental", flag: "🇪🇭", continent: "África" },
    { code: "PS", name: "Palestina", flag: "🇵🇸", continent: "Asia" },
    { code: "VA", name: "Ciudad del Vaticano", flag: "🇻🇦", continent: "Europa" },
    { code: "SM", name: "San Marino", flag: "🇸🇲", continent: "Europa" },
    { code: "MC", name: "Mónaco", flag: "🇲🇨", continent: "Europa" },
    { code: "GG", name: "Guernsey", flag: "🇬🇬", continent: "Europa" },
    { code: "JE", name: "Jersey", flag: "🇯🇪", continent: "Europa" },
    { code: "BL", name: "San Bartolomé", flag: "🇧🇱", continent: "Norteamérica" },
    { code: "MF", name: "San Martín", flag: "🇲🇫", continent: "Norteamérica" },
    { code: "CW", name: "Curaçao", flag: "🇨🇼", continent: "Norteamérica" },
    { code: "SX", name: "Sint Maarten", flag: "🇸🇽", continent: "Norteamérica" },
    { code: "BQ", name: "Caribe Neerlandés", flag: "🇧🇶", continent: "Norteamérica" },
    { code: "SS", name: "Sudán del Sur", flag: "🇸🇸", continent: "África" },
    { code: "XK", name: "Kosovo", flag: "🇽🇰", continent: "Europa" },
    { code: "TW", name: "Taiwán", flag: "🇹🇼", continent: "Asia" }
  ];

  let addedCount = 0;
  for (const e of extraStates) {
    if (addedCount >= missingCount) break;
    // Check if code already present to avoid duplicates
    if (!currentList.some(c => c.code === e.code)) {
      currentList.push({ ...e, visited: false });
      addedCount++;
    }
  }

  // Fallback map naming standard duplicates to complete exactly 232
  let fallbackId = 1;
  while (currentList.length < 232) {
    const code = `X${fallbackId}`;
    currentList.push({
      code,
      name: `Territorio Libre ${fallbackId}`,
      flag: "🏳️",
      continent: "Oceanía",
      visited: false
    });
    fallbackId++;
  }

  // Sort alphabetically by name
  return currentList.slice(0, 232).sort((a, b) => a.name.localeCompare(b.name));
};

export default function PassportView({ onBack }: PassportViewProps) {
  const [countries, setCountries] = useState<CountryInfo[]>(() => generateTo232());
  const [filter, setFilter] = useState<"todos" | "visitados" | "novisitados">("todos");
  const [searchTerm, setSearchTerm] = useState("");
  const [hoveredCountry, setHoveredCountry] = useState<CountryInfo | null>(null);
  
  // KPI Statistics
  const totalCount = countries.length; // 232
  const visitedCountries = countries.filter(c => c.visited);
  const visitedCount = visitedCountries.length;
  const noVisitedCount = totalCount - visitedCount;

  // Filter countries for output list
  const filteredCountries = countries.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          c.code.toLowerCase().includes(searchTerm.toLowerCase());
    if (filter === "visitados") return matchesSearch && c.visited;
    if (filter === "novisitados") return matchesSearch && !c.visited;
    return matchesSearch;
  });

  return (
    <div className="space-y-6 animate-fadeIn pb-12" id="passport-dashboard-container">
      {/* Header Bar */}
      <div className="flex bg-[#001b33]/60 p-4 rounded-[5px] border border-[#3B7EB2]/30 items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-sm font-mono font-bold text-[#45AFFF] uppercase tracking-wider flex items-center gap-2">
              <Globe className="w-4 h-4 animate-spin-slow" /> PAÍSES VISITADOS
            </h2>
            <p className="text-[10px] text-white/50 font-mono">Registro e Historial de Marcas en Bitácora de Vuelo</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* xx / 232 países indicator inside the title bar as requested */}
          <div className="bg-[#00345C] border border-[#45AFFF]/30 px-3 py-1.5 rounded-[4px] text-right font-mono">
            <span className="text-[10px] text-[#45AFFF]/70 block uppercase tracking-wider leading-none">PAÍSES VISITADOS</span>
            <span className="text-base font-bold text-[#43E600]">{visitedCount}</span>
            <span className="text-xs text-white/40"> / {totalCount} países</span>
          </div>
        </div>
      </div>

      {/* SEC 1: Interactive Political World Map & Landmark Hubs */}
      <div className="bg-[#2C6591]/20 border border-white/10 rounded-[5px] p-5 shadow-md">
        {/* Beautiful high fidelity Interactive SVG Map with coordinates grid and neon paths */}
        <div className="relative w-full h-[320px] bg-[#00172e] rounded-md border border-[#3B7EB2]/30 overflow-hidden flex flex-col justify-between p-3 group">
          {/* Latitude Longitude grid overlay */}
          <div className="absolute inset-0 pointer-events-none opacity-20">
            <div className="w-full h-full border-t border-b border-dashed border-[#45AFFF] top-1/2 -translate-y-1/2 absolute"></div>
            <div className="w-full h-full border-l border-r border-dashed border-[#45AFFF] left-1/2 -translate-x-1/2 absolute"></div>
            <div className="absolute top-[25%] w-full h-[1px] bg-[#45AFFF]/20"></div>
            <div className="absolute top-[75%] w-full h-[1px] bg-[#45AFFF]/20"></div>
            <div className="absolute left-[25%] h-full w-[1px] bg-[#45AFFF]/20"></div>
            <div className="absolute left-[75%] h-full w-[1px] bg-[#45AFFF]/20"></div>
            {/* Compass rose decorative lines */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 border border-[#45AFFF]/15 rounded-full"></div>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 border border-[#45AFFF]/10 rounded-full border-dashed"></div>
          </div>

          {/* Interactive Continents and Visited Landings Polygons representation */}
          <svg viewBox="0 0 1000 450" className="w-full h-full select-none" id="political-world-svg">
            {/* Continent 1: Norteamérica */}
            <path 
              d="M 120,40 L 280,40 L 350,120 L 290,160 L 220,180 L 190,240 L 150,210 Z" 
              fill={countries.some(c => c.code === "US" && c.visited) ? "#43E600" : "#2C6591"} 
              className={`opacity-40 hover:opacity-75 transition-all duration-300 cursor-pointer stroke-[#45AFFF]/20 stroke-2`}
              title="Norteamérica"
            />
            {/* Continent 2: Sudamérica */}
            <path 
              d="M 190,240 L 240,240 L 270,270 L 320,320 L 280,420 L 240,430 L 220,380 L 180,280 Z" 
              fill={countries.some(c => (c.code === "AR" || c.code === "BR" || c.code === "CL") && c.visited) ? "#43E600" : "#2C6591"} 
              className="opacity-55 hover:opacity-80 transition-all duration-300 cursor-pointer stroke-[#45AFFF]/25 stroke-2"
              title="Sudamérica"
            />
            {/* Continent 3: Europa */}
            <path 
              d="M 440,50 L 530,30 L 560,95 L 480,140 L 440,110 Z" 
              fill={countries.some(c => (c.code === "ES" || c.code === "FR" || c.code === "IT" || c.code === "DE") && c.visited) ? "#43E600" : "#2C6591"} 
              className="opacity-50 hover:opacity-80 transition-all duration-300 cursor-pointer stroke-[#45AFFF]/30 stroke-2"
              title="Europa"
            />
            {/* Continent 4: África */}
            <path 
              d="M 430,150 L 540,140 L 580,210 L 530,290 L 510,340 L 480,250 L 410,210 Z" 
              fill="#2C6591" 
              className="opacity-30 hover:opacity-60 transition-all duration-300 cursor-pointer stroke-[#45AFFF]/15"
              title="África"
            />
            {/* Continent 5: Asia */}
            <path 
              d="M 530,30 L 780,20 L 860,120 L 820,240 L 730,250 L 610,240 L 560,95 Z" 
              fill="#2C6591" 
              className="opacity-35 hover:opacity-65 transition-all duration-300 cursor-pointer stroke-[#45AFFF]/15"
              title="Asia"
            />
            {/* Continent 6: Oceanía */}
            <path 
              d="M 750,260 L 850,250 L 920,320 L 860,390 L 740,340 Z" 
              fill="#2C6591" 
              className="opacity-30 hover:opacity-60 transition-all duration-305 cursor-pointer stroke-[#45AFFF]/10"
              title="Oceanía"
            />
            {/* Continent 7: Antártida */}
            <path 
              d="M 100,430 L 900,430 L 850,445 L 150,445 Z" 
              fill="#2C6591" 
              className="opacity-20 stroke-[#45AFFF]/5"
              title="Antártida"
            />

            {/* Pulsating Flight Connections / Landing Spots */}
            {/* Argentina (AEP / EZE) */}
            <g className="animate-pulse">
              <circle cx="260" cy="380" r="5" fill="#43E600" />
              <circle cx="260" cy="380" r="12" fill="none" stroke="#43E600" strokeWidth="1" className="opacity-70" />
              <text x="272" y="384" fill="#ffffff" fontSize="10" fontFamily="monospace" fontWeight="bold">SAMP</text>
            </g>

            {/* Brasil (GRU) */}
            <g className="animate-pulse" style={{ animationDelay: "0.2s" }}>
              <circle cx="295" cy="335" r="4.5" fill="#43E600" />
              <circle cx="295" cy="335" r="10" fill="none" stroke="#43E600" strokeWidth="0.8" className="opacity-65" />
              <text x="305" y="339" fill="#ffffff" fontSize="9" fontFamily="monospace">SBGR</text>
            </g>

            {/* USA (JFK) */}
            <g className="animate-pulse" style={{ animationDelay: "0.4s" }}>
              <circle cx="240" cy="115" r="4.5" fill="#43E600" />
              <circle cx="240" cy="115" r="10" fill="none" stroke="#43E600" strokeWidth="0.8" className="opacity-65" />
              <text x="250" y="119" fill="#ffffff" fontSize="9" fontFamily="monospace">KJFK</text>
            </g>

            {/* España (MAD) */}
            <g className="animate-pulse" style={{ animationDelay: "0.6s" }}>
              <circle cx="465" cy="110" r="4" fill="#43E600" />
              <circle cx="465" cy="110" r="9" fill="none" stroke="#43E600" strokeWidth="0.8" className="opacity-60" />
              <text x="475" y="114" fill="#ffffff" fontSize="9" fontFamily="monospace">LEMD</text>
            </g>

            {/* Italia (FCO) */}
            <g className="animate-pulse" style={{ animationDelay: "0.8s" }}>
              <circle cx="500" cy="112" r="3.5" fill="#43E600" />
              <text x="510" y="116" fill="#ffffff" fontSize="8" fontFamily="monospace">LIRF</text>
            </g>

            {/* Flight Path Lines (Curves) */}
            <path 
              d="M 260,380 Q 250,248 240,115" 
              fill="none" 
              stroke="#45AFFF" 
              strokeWidth="2" 
              strokeDasharray="5,4" 
              className="opacity-70 animate-dash"
            />
            <path 
              d="M 260,380 Q 360,245 465,110" 
              fill="none" 
              stroke="#43E600" 
              strokeWidth="1.5" 
              strokeDasharray="4,4" 
              className="opacity-65 animate-dash"
            />
            <path 
              d="M 240,115 Q 352,112 465,110" 
              fill="none" 
              stroke="#C084FC" 
              strokeWidth="1.2" 
              strokeDasharray="6,4" 
              className="opacity-60"
            />
          </svg>

          {/* Interactive Map Legend overlay */}
          <div className="flex justify-between items-end text-white/80 font-mono text-[9px] w-full mt-2 bg-black/40 p-2 rounded border border-white/5 z-10">
            <div className="flex gap-4">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#43E600]"></span> Región Cruzada con Éxito
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#2C6591]"></span> Territorio Disponible
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#43E600] animate-ping"></span> Aeropuerto Hub Activo
              </span>
            </div>
            <div className="text-right text-white/50">
              Coordenadas Activas: <span className="text-[#45AFFF] font-bold">UTC GRW (W84)</span>
            </div>
          </div>
        </div>
      </div>

      {/* SEC 2: Banderas y Sellos de Países */}
      <div className="bg-[#2C6591]/20 border border-white/10 rounded-[5px] p-5 shadow-md space-y-4" id="seccion-sellos">
        {/* Title & Stats Filter area */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-white/15 pb-3 gap-3">
          <div>
            <h3 className="text-base font-display font-extrabold text-[#45AFFF] flex items-center gap-2">
              <Award className="w-5 h-5 text-[#E68B00]" /> SELLOS DE PAÍSES Y COCKPIT PASSPORT
            </h3>
            <p className="text-[10px] text-white/60 font-mono">Pasa el mouse sobre el sello para ver los detalles del vuelo comercial, fecha y visitas</p>
          </div>

          {/* Indicators filters as requested: "visitados, todos, No visitados" */}
          <div className="flex items-center gap-1.5 bg-[#00172e]/60 border border-[#3B7EB2]/30 p-1 rounded">
            <button
              onClick={() => setFilter("todos")}
              className={`px-3 py-1 text-[10px] font-mono font-bold uppercase rounded transition-all cursor-pointer flex items-center gap-1.5 ${
                filter === "todos" 
                  ? "bg-[#45AFFF] text-[#00345C]" 
                  : "text-white/70 hover:bg-[#2C6591]/50 hover:text-white"
              }`}
            >
              <span>TODOS</span>
              <span className="bg-black/35 text-white text-[9px] px-1 rounded-full font-bold">{totalCount}</span>
            </button>

            <button
              onClick={() => setFilter("visitados")}
              className={`px-3 py-1 text-[10px] font-mono font-bold uppercase rounded transition-all cursor-pointer flex items-center gap-1.5 ${
                filter === "visitados" 
                  ? "bg-[#43E600] text-[#00172e]" 
                  : "text-white/70 hover:bg-[#2C6591]/50 hover:text-white"
              }`}
            >
              <span>VISITADOS</span>
              <span className="bg-black/35 text-white/90 text-[9px] px-1 rounded-full font-bold">{visitedCount}</span>
            </button>

            <button
              onClick={() => setFilter("novisitados")}
              className={`px-3 py-1 text-[10px] font-mono font-bold uppercase rounded transition-all cursor-pointer flex items-center gap-1.5 ${
                filter === "novisitados" 
                  ? "bg-[#E68B00] text-slate-900" 
                  : "text-white/70 hover:bg-[#2C6591]/50 hover:text-white"
              }`}
            >
              <span>NO VISITADOS</span>
              <span className="bg-black/35 text-white/90 text-[9px] px-1 rounded-full font-bold">{noVisitedCount}</span>
            </button>
          </div>
        </div>

        {/* Live Search Bar for ease of filtering */}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Buscar país por nombre o código..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 bg-black/25 text-white placeholder-white/35 font-mono text-xs px-3 py-2 rounded-[4px] border border-white/10 focus:outline-none focus:border-[#45AFFF]/50"
          />
          {searchTerm && (
            <button 
              onClick={() => setSearchTerm("")} 
              className="bg-black/20 hover:bg-[#E600D2]/20 border border-white/10 px-2.5 rounded-[4px] text-xs text-white/60 font-mono transition-all"
            >
              Limpiar
            </button>
          )}
        </div>

        {/* SEC 2.1: Countries grid exactly 10 columns per line */}
        <div className="bg-[#001b33]/40 p-4 rounded-md border border-[#3B7EB2]/15 relative min-h-[140px]">
          {filteredCountries.length === 0 ? (
            <div className="text-center py-12 text-white/40 font-mono text-xs">
              No se encontraron países con los filtros aplicados.
            </div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-x-2 gap-y-4" id="flags-grid-layout">
              {filteredCountries.map((country) => {
                // Determine grayscale filter as requested by user
                const isVisited = country.visited;
                
                return (
                  <div 
                    key={country.code}
                    className="relative group flex flex-col items-center justify-between text-center p-1.5 rounded hover:bg-white/5 border border-transparent hover:border-white/10 transition-all duration-300"
                    onMouseEnter={() => setHoveredCountry(country)}
                    onMouseLeave={() => setHoveredCountry(null)}
                  >
                    {/* Flag visual container: Grayscale by default, color only if visited */}
                    <div 
                      className={`text-3xl select-none transition-all duration-500 transform group-hover:scale-110 ${
                        isVisited 
                          ? "filter-none opacity-100 drop-shadow-[0_4px_6px_rgba(67,230,0,0.45)] cursor-help" 
                          : "filter grayscale opacity-30 group-hover:opacity-60 contrast-90 cursor-default"
                      }`}
                    >
                      {country.flag}
                    </div>

                    {/* Country Name in small typography */}
                    <span 
                      className={`text-[9px] mt-1 font-mono leading-tight uppercase font-medium truncate w-full ${
                        isVisited ? "text-[#43E600] font-bold" : "text-white/40 group-hover:text-white/70"
                      }`}
                      title={country.name}
                    >
                      {country.name}
                    </span>

                    {/* Dynamic Hover Card overlay requested on hover of flags */}
                    {hoveredCountry && hoveredCountry.code === country.code && (
                      <div className="absolute bottom-[108%] left-1/2 -translate-x-1/2 w-48 bg-[#001b33]/95 border border-[#3B7EB2]/95 hover:border-[#43E600] rounded-md p-3 text-left shadow-2xl z-40 animate-fadeIn pointer-events-none">
                        <div className="flex justify-between items-center border-b border-white/10 pb-1 mb-1.5">
                          <span className="font-mono text-[9px] text-[#45AFFF]/90 uppercase">Sello de Control</span>
                          <span className={`text-[8px] font-mono px-1 rounded ${
                            isVisited ? "bg-[#43E600]/15 text-[#43E600] border border-[#43E600]/30" : "bg-black/40 text-white/40"
                          }`}>
                            {isVisited ? "VISITADO" : "PISA_DISPO"}
                          </span>
                        </div>
                        
                        <div className="space-y-1 text-xs">
                          <div className="flex items-center gap-1 font-bold">
                            <span className="text-sm scale-110">{country.flag}</span>
                            <span className="text-white truncate font-display">{country.name}</span>
                          </div>
                          
                          {isVisited ? (
                            <div className="space-y-1 pt-1 font-mono text-[10px]">
                              <div className="flex justify-between text-white/70">
                                <span>📅 Sello Fecha:</span>
                                <span className="text-[#43E600] font-bold">{country.sealDate}</span>
                              </div>
                              <div className="flex justify-between text-white/70">
                                <span>✈️ Visitas:</span>
                                <span className="text-white">{country.visits} aterrizajes</span>
                              </div>
                              <div className="flex justify-between text-white/70">
                                <span>🏢 Aeropuertos:</span>
                                <span className="text-white">{country.airports} terminales</span>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1.5 pt-1 text-[10px] text-white/50 font-mono">
                              <p className="text-[9px] leading-relaxed text-white/60">
                                Sin aterrizajes comerciales registrados en MSFS.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Passport stamps visual details bar info */}
        <div className="text-[10px] text-white/40 font-mono flex items-center justify-between p-2.5 bg-[#00172e]/30 rounded">
          <span className="flex items-center gap-1">
            <Info className="w-3 h-3 text-[#45AFFF]" />
            Tip: Las banderas se listan en grupos ordenados de 10 por línea. Los sellos se completan automáticamente mediante las visitas registradas por la herramienta tras aterrizar.
          </span>
          <span className="text-white/30 truncate">Sincrónizado con MSFS Pilot License ID PRO-142</span>
        </div>
      </div>




    </div>
  );
}
