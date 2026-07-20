/** All internal physics is SI: meters, kilograms, seconds, joules. */
export const G = 6.6743e-11; // m^3 kg^-1 s^-2 (CODATA 2018)

export const AU = 1.495978707e11; // m
export const DAY = 86400; // s
export const YEAR = 3.15576e7; // s (Julian year)

export const SUN = { mass: 1.9885e30, radius: 6.957e8 };
export const EARTH = { mass: 5.9722e24, radius: 6.371e6, a: 1.495978707e11, vOrbit: 29784.8 };
export const MOON = { mass: 7.342e22, radius: 1.7374e6, a: 3.844e8, vOrbit: 1022 };
export const JUPITER = { mass: 1.8982e27, radius: 6.9911e7, a: 7.7857e11, vOrbit: 13070 };
