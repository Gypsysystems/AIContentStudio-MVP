import { expect, test } from "@playwright/test"
import { jsPDF } from "jspdf"

function semanticPaletteFixture() {
  const pdf = new jsPDF({ unit: "pt", format: "a4" })
  pdf.setFont("helvetica", "normal")
  pdf.setFontSize(10)
  pdf.text("Acme Brand Guidelines", 25, 25)
  pdf.text("Color palette", 25, 45)
  pdf.text("Color role", 25, 65)
  pdf.text("Hex value", 235, 65)
  const colors = [
    ["Primary", "#112233"],
    ["Secondary", "#223344"],
    ["Accent", "#D9732C"],
    ["Background", "#F8F6F2"],
    ["Surface", "#FFFFFF"],
    ["Text / Body", "#1A2330"],
    ["Heading", "#3A4455"],
    ["Border", "#CCD1D8"],
    ["Success", "#278A53"],
    ["Warning", "#C9851F"],
    ["Critical / Error", "#B83A41"],
    ["Info", "#2A7DB3"],
    ["Primary / Secondary", "#758190"],
    ["Unlabeled swatch", "#667788"],
  ]
  colors.forEach(([role, value], i) => {
    pdf.text(role, 25, 83 + 19 * i)
    pdf.text(value, 235, 83 + 19 * i)
  })
  pdf.text("Typography", 25, 380)
  pdf.text("Typography role", 25, 402)
  pdf.text("Font family", 150, 402)
  pdf.text("H1", 25, 420)
  pdf.text("Aptos Display", 150, 420)
  pdf.text("Body Text", 25, 438)
  pdf.text("Aptos", 150, 438)
  pdf.text("Footnote", 25, 456)
  pdf.text("g_d0_f1", 150, 456)
  pdf.text("Title", 25, 474)
  pdf.text("sans-serif", 150, 474)
  return new Uint8Array(pdf.output("arraybuffer"))
}

test("maps explicit palette rows by their own labels and leaves ambiguous colors unresolved", async ({ page }) => {
  await page.goto("/")
  const result = await page.evaluate(async bytes => {
    const { extractBrandFromFile, extractColors } = await import("/src/brandExtractor.ts")
    const parsed = await extractBrandFromFile(
      new File([new Uint8Array(bytes)], "acme-guidelines.pdf", { type: "application/pdf" }),
    )
    return {
      colors: parsed.colors,
      fonts: parsed.fonts.map(font => font.family),
      conflicts: extractColors("Primary #ABCDEF\nSecondary #ABCDEF\nUnlabeled #778899"),
      table: extractColors("", ["Primary | #123456", "Secondary | #234567", "Accent | #345678"]),
      rgb: extractColors("Primary rgb(12, 34, 56)\nSecondary rgb(34, 51, 68)"),
    }
  }, Array.from(semanticPaletteFixture()))
  const colors = new Map(result.colors.map(color => [color.value, color]))
  for (const [value, role] of [
    ["#112233", "Primary"], ["#223344", "Secondary"], ["#D9732C", "Accent"],
    ["#F8F6F2", "Background"], ["#FFFFFF", "Surface"], ["#1A2330", "Body Text"],
    ["#3A4455", "Heading"], ["#CCD1D8", "Border"], ["#278A53", "Success"],
    ["#C9851F", "Warning"], ["#B83A41", "Critical"], ["#2A7DB3", "Info"],
  ]) {
    expect(colors.get(value)?.suggestedRole, value).toBe(role)
    expect(colors.get(value)?.sourceSnippet).toContain(value)
    expect(colors.get(value)?.confidence).toBe("high")
  }
  expect(colors.get("#758190")?.suggestedRole).toBe("Needs Review")
  expect(colors.get("#667788")?.suggestedRole).toBe("Needs Review")
  expect(result.fonts).not.toContain("g_d0_f1")
  expect(result.fonts).not.toContain("sans-serif")
  expect(result.conflicts[0]).toMatchObject({ value: "#ABCDEF", suggestedRole: "Needs Review" })
  expect(result.conflicts[0].sourceSnippet).toContain("Secondary #ABCDEF")
  expect(result.conflicts[1].suggestedRole).toBe("Needs Review")
  expect(result.table.map(color => color.suggestedRole)).toEqual(["Primary", "Secondary", "Accent"])
  expect(result.rgb.map(color => color.suggestedRole)).toEqual(["Primary", "Secondary"])
})

test("imports reviewed semantic palette into the existing profile tokens without defaulting unresolved colors", async ({ page }) => {
  const projectName = `Palette mapping ${Date.now()}`
  await page.goto("/")
  await page.getByRole("button", { name: /New Project/ }).first().click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill(projectName)
  await page.getByRole("button", { name: "Continue — Theme & Styles" }).click()
  await page.getByRole("heading", { name: "Theme & Style Profiles" }).waitFor()
  await page.getByTitle("Import from DOCX/PDF").click()
  await page.locator('input[type=file][accept*=".pdf"]').setInputFiles({
    name: "acme-guidelines.pdf", mimeType: "application/pdf",
    buffer: Buffer.from(semanticPaletteFixture()),
  })
  await page.getByRole("button", { name: "Analyze Brand Guidelines" }).click()
  await page.getByText("Detected Colors", { exact: true }).waitFor({ timeout: 30_000 })
  for (const [value, role] of [
    ["#112233", "Primary"], ["#223344", "Secondary"], ["#D9732C", "Accent"],
    ["#F8F6F2", "Background"], ["#1A2330", "Body Text"],
    ["#278A53", "Success"], ["#C9851F", "Warning"],
    ["#B83A41", "Critical"], ["#2A7DB3", "Info"],
  ]) {
    await expect(page.getByText(value, { exact: true }).first().locator("xpath=../..").locator("select").first())
      .toHaveValue(role)
  }
  await page.getByRole("button", { name: "Accept All Reviewed" }).click()
  await page.getByPlaceholder("e.g. Imported Corporate Brand").fill("Reviewed palette")
  await expect(page.getByRole("button", { name: "Save as New Brand & Style Profile" })).toBeDisabled()
  await page.getByRole("button", { name: "← Back", exact: true }).click()
  for (const value of ["#758190", "#667788"]) {
    await page.getByText(value, { exact: true }).first().locator("xpath=../..")
      .getByRole("button", { name: "Ignore" }).click()
  }
  await page.getByRole("button", { name: "Review & Save →" }).click()
  await page.getByRole("button", { name: "Save as New Brand & Style Profile" }).click()
  const readSavedStyle = () => page.evaluate(async projectName => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("docflow-db", 3)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const projects = await new Promise<any[]>((resolve, reject) => {
      const request = db.transaction("projects", "readonly").objectStore("projects").getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return projects.find(project => project.projectName === projectName)?.themes
      ?.flatMap((theme: any) => theme.styleProfiles)
      .find((candidate: any) => candidate.name === "Reviewed palette")
  }, projectName)
  await expect.poll(async () => (await readSavedStyle())?.primaryColor).toBe("#112233")
  const style = await readSavedStyle()
  expect(style).toMatchObject({
    primaryColor: "#112233", secondaryColor: "#223344", accentColor: "#D9732C",
    bgColor: "#F8F6F2", surfaceColor: "#FFFFFF", bodyTextColor: "#1A2330",
    headingTextColor: "#3A4455", borderColorToken: "#CCD1D8",
    successColor: "#278A53", warningColor: "#C9851F",
    criticalColor: "#B83A41", infoColor: "#2A7DB3",
  })
  expect(JSON.stringify(style)).not.toMatch(/#758190|#667788|g_d0_f1|sans-serif/)
})

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