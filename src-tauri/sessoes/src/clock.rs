//! Horários em milissegundos desde 1970 (UTC), como o `Date.now()` do JavaScript, e a leitura dos
//! horários ISO 8601 que os históricos gravam, sem biblioteca de datas.

use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) const HOUR_MS: i64 = 3_600_000;
const DAY_MS: i64 = 24 * HOUR_MS;

/// Agora, pelo relógio do sistema.
pub(crate) fn now_ms() -> i64 {
    system_time_ms(SystemTime::now())
}

/// Um horário do sistema (ex.: a data de um arquivo) em milissegundos desde 1970.
pub(crate) fn system_time_ms(time: SystemTime) -> i64 {
    match time.duration_since(UNIX_EPOCH) {
        Ok(after) => i64::try_from(after.as_millis()).unwrap_or(i64::MAX),
        Err(before) => -i64::try_from(before.duration().as_millis()).unwrap_or(i64::MAX),
    }
}

/// Lê um horário como os dos históricos ("2026-11-09T14:44:24.748Z") e devolve os milissegundos
/// desde 1970.
///
/// Segue o `Date.parse` do JavaScript no que interessa: segundos e fração opcionais (a fração pode
/// ter qualquer tamanho; valem os 3 primeiros dígitos), "Z" ou um fuso como "+00:00", "-03:00" ou
/// "-0300", "T" (ou espaço) entre a data e a hora, e só a data ("2026-11-09", meia-noite UTC).
/// Como no JavaScript, o dia vai até 31 em qualquer mês (30 de fevereiro vira 2 de março) e
/// "24:00" é a meia-noite seguinte. Sem fuso, o JavaScript usaria a hora local; aqui fica sem
/// horário (`None`), como tudo o que não se consegue ler.
pub(crate) fn parse_iso_ms(value: &str) -> Option<i64> {
    let b = value.as_bytes();
    let mut i = 0;
    let year = digits(b, &mut i, 4)?;
    expect(b, &mut i, b'-')?;
    let month = digits(b, &mut i, 2)?;
    expect(b, &mut i, b'-')?;
    let day = digits(b, &mut i, 2)?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let days = days_from_civil(year, month, day);
    if i == b.len() {
        return Some(days * DAY_MS);
    }

    if !matches!(b.get(i), Some(b'T' | b't' | b' ')) {
        return None;
    }
    i += 1;
    let hour = digits(b, &mut i, 2)?;
    expect(b, &mut i, b':')?;
    let minute = digits(b, &mut i, 2)?;
    let mut second = 0;
    let mut millis = 0;
    if b.get(i) == Some(&b':') {
        i += 1;
        second = digits(b, &mut i, 2)?;
        if b.get(i) == Some(&b'.') {
            i += 1;
            let start = i;
            while b.get(i).is_some_and(u8::is_ascii_digit) {
                i += 1;
            }
            if i == start {
                return None;
            }
            // Os milissegundos: os 3 primeiros dígitos, completando com zeros (".5" = 500).
            let fraction = &b[start..i];
            for k in 0..3 {
                millis = millis * 10 + fraction.get(k).map_or(0, |d| i64::from(d - b'0'));
            }
        }
    }
    let end_of_day = hour == 24 && minute == 0 && second == 0 && millis == 0;
    if (hour > 23 && !end_of_day) || minute > 59 || second > 59 {
        return None;
    }

    let offset_minutes = match b.get(i) {
        Some(b'Z' | b'z') => {
            i += 1;
            0
        }
        Some(&sign @ (b'+' | b'-')) => {
            i += 1;
            let hours = digits(b, &mut i, 2)?;
            if b.get(i) == Some(&b':') {
                i += 1;
            }
            let minutes = digits(b, &mut i, 2)?;
            if hours > 23 || minutes > 59 {
                return None;
            }
            let total = hours * 60 + minutes;
            if sign == b'-' {
                -total
            } else {
                total
            }
        }
        _ => return None,
    };
    if i != b.len() {
        return None;
    }
    Some(
        days * DAY_MS + hour * HOUR_MS + minute * 60_000 + second * 1000 + millis
            - offset_minutes * 60_000,
    )
}

/// Exatamente `n` dígitos a partir de `i`.
fn digits(b: &[u8], i: &mut usize, n: usize) -> Option<i64> {
    let part = b.get(*i..*i + n)?;
    if !part.iter().all(u8::is_ascii_digit) {
        return None;
    }
    *i += n;
    Some(part.iter().fold(0, |acc, d| acc * 10 + i64::from(d - b'0')))
}

fn expect(b: &[u8], i: &mut usize, c: u8) -> Option<()> {
    if b.get(*i) != Some(&c) {
        return None;
    }
    *i += 1;
    Some(())
}

/// Os dias de 1970-01-01 até a data (o algoritmo "days_from_civil" de Howard Hinnant). Conta o dia
/// em linha reta, então um dia além do fim do mês cai no mês seguinte, como no JavaScript.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let year_of_era = y - era * 400;
    let month_from_march = (month + 9) % 12;
    let day_of_year = (153 * month_from_march + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// O contrário de [`days_from_civil`]: (ano, mês, dia).
#[cfg(test)]
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_from_march = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_from_march + 2) / 5 + 1;
    let month = if month_from_march < 10 {
        month_from_march + 3
    } else {
        month_from_march - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// Como o `toISOString()` do JavaScript: "2026-11-09T14:44:24.748Z". Só os testes usam.
#[cfg(test)]
pub(crate) fn format_iso_ms(ms: i64) -> String {
    let (year, month, day) = civil_from_days(ms.div_euclid(DAY_MS));
    let rest = ms.rem_euclid(DAY_MS);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rest / HOUR_MS,
        rest % HOUR_MS / 60_000,
        rest % 60_000 / 1000,
        rest % 1000
    )
}
