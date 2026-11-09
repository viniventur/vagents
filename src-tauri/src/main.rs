// Sem a janela de console no Windows na versão instalada (no desenvolvimento ela mostra os logs).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    vagents_lib::run()
}
