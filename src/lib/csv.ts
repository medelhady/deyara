/**
 * Rows to CSV, for opening in Excel.
 *
 * Two details decide whether the file is readable at all:
 *
 * The BOM. Excel reads a CSV without one in the system codepage, which turns every Arabic字 into
 * mojibake. It is three bytes and it is the difference between a usable file and a useless one.
 *
 * The tab before long digits. Excel helpfully reformats 22245678901 into 2.2245E+10 and drops a
 * leading +, mangling every phone number in the export. A leading tab makes it keep the text.
 */
const bom = "﻿";

function cell(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  // Nested JSON (a conversation state, a metadata blob) has no flat form, so it goes in as text.
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  const needsGuard = /^\+?\d{8,}$/.test(text);
  const guarded = needsGuard ? `\t${text}` : text;

  return /[",\n\r\t]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv(rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) {
    return bom;
  }

  // Union of keys, not just the first row's: a nullable column missing from row one still gets a
  // header, so its values elsewhere are not silently dropped.
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];

  const lines = [
    headers.map(cell).join(","),
    ...rows.map((row) => headers.map((header) => cell(row[header])).join(","))
  ];

  return bom + lines.join("\r\n");
}
