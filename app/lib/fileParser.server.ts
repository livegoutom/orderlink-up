import ExcelJS from "exceljs";
import Papa from "papaparse";

export interface ParsedFile {
  headers: string[];
  rows: string[][];
}

export async function parseUploadedFile(buffer: Buffer, fileName: string): Promise<ParsedFile> {
  const ext = fileName.toLowerCase().split(".").pop();

  if (ext === "csv") {
    return parseCsv(buffer);
  }
  if (ext === "xlsx" || ext === "xls") {
    return parseExcel(buffer);
  }
  throw new Error(`Unsupported file type: .${ext}. Please upload a .csv or .xlsx file.`);
}

function parseCsv(buffer: Buffer): ParsedFile {
  const text = buffer.toString("utf-8");
  const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
  const [headerRow, ...dataRows] = result.data;

  return {
    headers: (headerRow ?? []).map((h) => String(h ?? "").trim()),
    rows: dataRows.map((row) => row.map((cell) => String(cell ?? "").trim())),
  };
}

async function parseExcel(buffer: Buffer): Promise<ParsedFile> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("No worksheet found in the uploaded file.");
  }

  const rows: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as ExcelJS.CellValue[];
    // ExcelJS row.values is 1-indexed; index 0 is always undefined
    rows.push(values.slice(1).map(cellToString));
  });

  const [headerRow, ...dataRows] = rows;
  return {
    headers: headerRow ?? [],
    rows: dataRows,
  };
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("text" in value && value.text != null) return String(value.text);
    if ("result" in value && value.result != null) return String(value.result);
    return "";
  }
  return String(value).trim();
}
