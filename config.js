'use strict';

// Podaci za spajanje na zajedničku bazu (Supabase → Project Settings → API).
// „anon” ključ je javan i smije biti u aplikaciji — zaštitu podataka osiguravaju pravila u bazi (RLS).
// NIKAD ovdje ne upisuj „service_role” ključ.
// Ako su vrijednosti prazne, aplikacija radi bez zajedničke baze (samo Open Facts + lokalni unos).
window.APP_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
