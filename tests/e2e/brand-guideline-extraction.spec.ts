import { expect, test } from "@playwright/test"
import { jsPDF } from "jspdf"

test("extracts role-specific typography from a brand-guideline PDF table, not embedded font metadata", async ({ page }) => {
  const pdf = new jsPDF({ unit: "pt", format: "a4" })
  pdf.setFont("helvetica", "normal")
  pdf.setFontSize(10)
  pdf.text("Acme Brand Guidelines", 25, 25)
  pdf.text("Typography", 25, 42)

  const columns = [25, 142, 292, 365, 435]
  const header = ["Typography role", "Font family", "Weight", "Size", "Color"]
  header.forEach((value, index) => pdf.text(value, columns[index], 65))
  const rows = [
    ["Document Title", "Aptos Display", "Bold", "30 pt", "#112233"],
    ["H1", "Aptos Display", "Bold", "24 pt", "#112233"],
    ["H2", "Aptos Display", "Semibold", "20 pt", "#223344"],
    ["H3", "Aptos Display", "Medium", "16 pt", "#334455"],
    ["H4", "", "Regular", "14 pt", "#334455"],
    ["Body Text", "Aptos", "Regular", "11 pt", "#334455"],
    ["Caption", "Aptos", "Regular", "9 pt", "#556677"],
    ["Code", "Consolas", "Regular", "10 pt", "#445566"],
    ["Footnote", "g_d0_f1", "Regular", "8 pt", "#445566"],
    ["Title", "sans-serif", "Bold", "28 pt", "#112233"],
  ]
  rows.forEach((row, rowIndex) =>
    row.forEach((value, columnIndex) => {
      if (value) pdf.text(value, columns[columnIndex], 82 + rowIndex * 20)
    }),
  )

  await page.goto("/")
  const result = await page.evaluate(async (bytes) => {
    const path = "/src/brandExtractor.ts"
    const { extractBrandFromFile } = await import(path)
    return extractBrandFromFile(
      new File([new Uint8Array(bytes)], "acme-guidelines.pdf", { type: "application/pdf" }),
    )
  }, Array.from(new Uint8Array(pdf.output("arraybuffer"))))

  const styles = new Map(result.typographyStyles.map(style => [style.role, style]))
  expect(result.diagnostics.fileParsed).toBe(true)
  expect(result.diagnostics.typographyTablesFound).toBeGreaterThan(0)
  expect(styles.get("Document Title")).toMatchObject({
    fontFamily: "Aptos Display", fontSize: 30, fontWeight: "700", color: "#112233",
  })
  expect(styles.get("Heading 1")?.fontFamily).toBe("Aptos Display")
  expect(styles.get("Heading 2")).toMatchObject({ fontFamily: "Aptos Display", fontWeight: "600" })
  expect(styles.get("Body")?.fontFamily).toBe("Aptos")
  expect(styles.get("Caption")?.fontFamily).toBe("Aptos")
  expect(styles.get("Code")?.fontFamily).toBe("Consolas")
  expect(styles.get("Heading 3")).toMatchObject({ fontFamily: "Aptos Display", fontSize: 16, fontWeight: "500" })
  expect(styles.get("Heading 4")).toMatchObject({ fontSize: 14, fontWeight: "400" })
  expect(styles.get("Heading 4")?.fontFamily).toBeUndefined()
  expect(styles.get("Footnote")?.fontFamily).toBeUndefined()
  expect(styles.get("Title")?.fontFamily).toBeUndefined()
  expect(result.fonts.map(font => font.family).sort()).toEqual(["Aptos", "Aptos Display", "Consolas"])
})

test("resolves only explicitly labeled nearby prose, leaving missing roles unresolved", async ({ page }) => {
  const guidelineText = [
    "Typography",
    "Document Title",
    "Font family: Aptos Display",
    "Size: 30 pt",
    "Weight: Bold",
    "H1",
    "Font family: Aptos Display",
    "H2",
    "Font family: Aptos Display",
    "H3",
    "Size: 16 pt",
    "Body Text",
    "Font family: Aptos",
    "Caption font: Aptos",
    "Code font: Consolas",
    "Footnote",
    "Font family: monospace",
    "Typeface: Franklin Gothic",
  ].join("\n")

  await page.goto("/")
  const result = await page.evaluate(async text => {
    const path = "/src/brandExtractor.ts"
    const { extractFonts, extractTypographyStyles } = await import(path)
    return {
      fonts: extractFonts(text, [], [], [], ["g_d0_f1", "sans-serif"]),
      styles: extractTypographyStyles(text),
    }
  }, guidelineText)

  const styles = new Map(result.styles.map(style => [style.role, style]))
  expect(styles.get("Document Title")).toMatchObject({ fontFamily: "Aptos Display", fontSize: 30, fontWeight: "700" })
  expect(styles.get("Heading 1")?.fontFamily).toBe("Aptos Display")
  expect(styles.get("Heading 2")?.fontFamily).toBe("Aptos Display")
  expect(styles.get("Heading 3")).toMatchObject({ fontSize: 16 })
  expect(styles.get("Heading 3")?.fontFamily).toBeUndefined()
  expect(styles.get("Body")?.fontFamily).toBe("Aptos")
  expect(styles.get("Caption")?.fontFamily).toBe("Aptos")
  expect(styles.get("Code")?.fontFamily).toBe("Consolas")
  expect(styles.get("Footnote")?.fontFamily).toBeUndefined()
  expect(result.fonts.map(font => font.family).sort()).toEqual(["Aptos", "Aptos Display", "Consolas", "Franklin Gothic"])
  expect(result.fonts.find(font => font.family === "Franklin Gothic")?.suggestedRole).toBe("Unknown")
})