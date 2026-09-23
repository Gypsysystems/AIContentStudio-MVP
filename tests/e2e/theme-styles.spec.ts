import { expect, test, type Page } from "@playwright/test"

type StoredProject = {
  projectId: string
  projectName: string
  activeStyleProfileId?: string
  projectMeta?: Record<string, unknown>
  themes: Array<{
    styleProfiles: Array<Record<string, unknown>>
  }>
  pageLayouts: Array<Record<string, unknown>>
  htmlMasterPages: Array<Record<string, unknown>>
}

async function createProject(page: Page, projectName: string) {
  await page.goto("/")
  await page.getByRole("button", { name: /New Project/ }).first().click()
  await page.locator('input[placeholder^="e.g. Nexus Platform"]').fill(projectName)
  await page.getByRole("button", { name: "Continue — Theme & Styles" }).click()
  await expect(
    page.getByRole("heading", { name: "Theme & Style Profiles" }),
  ).toBeVisible()
}

async function readOnlyProject(page: Page): Promise<StoredProject> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("docflow-db", 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return new Promise((resolve, reject) => {
      const request = db
        .transaction("projects", "readonly")
        .objectStore("projects")
        .getAll()
      request.onsuccess = () => {
        const projects = request.result as StoredProject[]
        resolve(projects.sort((a, b) =>
          a.projectName.localeCompare(b.projectName),
        )[0])
      }
      request.onerror = () => reject(request.error)
    })
  })
}

async function updateOnlyProject(
  page: Page,
  update: (project: StoredProject) => StoredProject,
) {
  const project = await readOnlyProject(page)
  const updated = update(project)
  await page.evaluate(async (record) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("docflow-db", 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("projects", "readwrite")
      transaction.objectStore("projects").put(record)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }, updated)
}

async function chooseFont(page: Page, sectionName: string, font: string) {
  const section = page
    .getByText(sectionName, { exact: true })
    .locator("..")
    .locator("..")
  await section.getByRole("button").first().click()
  await section.getByPlaceholder("Search fonts…").fill(font)
  await section.getByRole("button", { name: font, exact: true }).click()
}

test("persists an applied style profile and output template edits", async ({
  page,
}) => {
  test.setTimeout(60_000)
  const projectName = `Theme Persistence ${Date.now()}`
  const profileName = `Rich Profile ${Date.now()}`

  await createProject(page, projectName)

  await page.getByRole("button", { name: "+ New" }).click()
  const createProfile = page.getByRole("heading", {
    name: "Create Brand & Style Profile",
  }).locator("..")
  await createProfile.getByRole("textbox").fill(profileName)
  await createProfile.getByRole("button", { name: "Create" }).click()

  await page.getByRole("button", { name: "Colors", exact: true }).click()
  const primaryRow = page.getByText("Primary", { exact: true }).locator("..")
  await primaryRow.getByRole("button").first().click()
  await primaryRow.locator("input").fill("#C2410C")
  await primaryRow.getByRole("button", { name: "Apply" }).click()
  await page.getByRole("button", { name: "Save Colors" }).click()

  await page.getByRole("button", { name: "Typography", exact: true }).click()
  await chooseFont(page, "Heading Font", "Georgia")
  await chooseFont(page, "Body Font", "Verdana")
  await page.getByRole("button", { name: "Save Typography" }).click()
  await page.getByRole("button", { name: "Apply to Project" }).click()
  await expect(
    page.getByRole("button", { name: "✓ Applied to Project" }),
  ).toBeVisible()

  await page.getByRole("button", { name: "Output Templates" }).click()
  const orientation = page.getByText("Orientation", { exact: true }).locator("..")
  await orientation.locator("select").selectOption("landscape")

  await page.getByRole("button", { name: "HTML Master Pages" }).click()
  const contentWidth = page.getByText("Content Width (px)", { exact: true }).locator("..")
  await contentWidth.locator("input").fill("1400")
  await contentWidth.locator("input").blur()
  await expect(page.getByText("✓ Saved").first()).toBeVisible()

  await page.getByRole("button", { name: /Content Studio/ }).click()
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible()
  await page.getByText(projectName, { exact: true }).click()
  await expect(page.getByText("Sources", { exact: true }).first()).toBeVisible()
  await page.reload()
  await expect(page.getByText(projectName, { exact: true }).first()).toBeVisible()

  const stored = await readOnlyProject(page)
  const profiles = stored.themes.flatMap((theme) => theme.styleProfiles)
  const profile = profiles.find((candidate) => candidate.name === profileName)
  expect(profile).toMatchObject({
    primaryColor: "#C2410C",
    headingFont: "Georgia",
    bodyFont: "Verdana",
  })
  expect(stored.activeStyleProfileId).toBe(profile?.id)
  expect(stored.projectMeta?.styleProfileId).toBe(profile?.id)
  expect(
    stored.pageLayouts.some((layout) => layout.orientation === "landscape"),
  ).toBe(
    true,
  )
  expect(
    stored.htmlMasterPages.some((master) => master.contentWidth === 1400),
  ).toBe(true)

  await page.getByRole("button", { name: /Theme$/ }).click()
  await expect(page.getByRole("textbox", { name: "Search profiles…" })).toHaveValue(
    profileName,
  )
  await expect(
    page.getByRole("button", { name: "✓ Applied to Project" }),
  ).toBeVisible()
})

test("clears a deleted applied profile until a remaining profile is explicitly applied", async ({
  page,
}) => {
  const projectName = `Profile Deletion ${Date.now()}`
  await createProject(page, projectName)

  for (const name of ["Remaining Profile", "Applied Profile"]) {
    await page.getByRole("button", { name: "+ New" }).click()
    const modal = page.getByRole("heading", {
      name: "Create Brand & Style Profile",
    }).locator("..")
    await modal.getByRole("textbox").fill(name)
    await modal.getByRole("button", { name: "Create", exact: true }).click()
  }
  await page.getByRole("button", { name: "Apply to Project", exact: true }).click()
  await expect(page.getByRole("button", { name: "✓ Applied to Project" })).toBeVisible()
  await expect.poll(async () => {
    const stored = await readOnlyProject(page)
    const applied = stored.themes.flatMap(theme => theme.styleProfiles)
      .find(profile => profile.name === "Applied Profile")
    return !!applied && stored.activeStyleProfileId === applied.id
      && stored.projectMeta?.styleProfileId === applied.id
  }).toBe(true)

  page.once("dialog", dialog => dialog.accept())
  await page.getByRole("button", { name: "Delete", exact: true }).click()
  await expect(page.getByRole("button", { name: "Apply to Project", exact: true })).toBeVisible()
  const expectUnapplied = async () => {
    await expect.poll(async () => {
      const stored = await readOnlyProject(page)
      return stored.activeStyleProfileId === ""
        && stored.projectMeta?.styleProfileId === ""
        && !stored.themes.flatMap(theme => theme.styleProfiles)
          .some(profile => profile.name === "Applied Profile")
    }).toBe(true)
  }
  await expectUnapplied()

  await page.reload()
  await expect(page.getByText("Sources", { exact: true }).first()).toBeVisible()
  await page.getByRole("button", { name: /Theme$/ }).click()
  await expect(page.getByRole("button", { name: "Apply to Project", exact: true })).toBeVisible()
  await expectUnapplied()

  await page.getByRole("textbox", { name: "Search profiles…" }).click()
  await page.getByRole("button", { name: "Remaining Profile Reusable", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Search profiles…" })).toHaveValue("Remaining Profile")
  await expect(page.getByRole("button", { name: "Apply to Project", exact: true })).toBeVisible()
  await expectUnapplied()
  await page.getByRole("button", { name: "Apply to Project", exact: true }).click()
  await expect.poll(async () => {
    const stored = await readOnlyProject(page)
    const remaining = stored.themes.flatMap(theme => theme.styleProfiles)
      .find(profile => profile.name === "Remaining Profile")
    return !!remaining && stored.activeStyleProfileId === remaining.id
      && stored.projectMeta?.styleProfileId === remaining.id
  }).toBe(true)

  await page.reload()
  await expect(page.getByText("Sources", { exact: true }).first()).toBeVisible()
  await page.getByRole("button", { name: /Theme$/ }).click()
  await expect(page.getByRole("textbox", { name: "Search profiles…" })).toHaveValue("Remaining Profile")
  await expect(page.getByRole("button", { name: "✓ Applied to Project" })).toBeVisible()
})

for (const scenario of [
  { title: "deletes an unused profile without changing project styling", target: "Unused Profile", confirm: true },
  { title: "keeps an unused profile when deletion is cancelled", target: "Unused Profile", confirm: false },
  { title: "keeps the applied profile when deletion is cancelled", target: "Applied Profile", confirm: false },
]) {
  test(scenario.title, async ({ page }) => {
    await createProject(page, `Safe Profile Deletion ${Date.now()}`)
    for (const name of ["Unused Profile", "Applied Profile"]) {
      await page.getByRole("button", { name: "+ New" }).click()
      const modal = page.getByRole("heading", {
        name: "Create Brand & Style Profile",
      }).locator("..")
      await modal.getByRole("textbox").fill(name)
      await modal.getByRole("button", { name: "Create", exact: true }).click()
    }
    await page.getByRole("button", { name: "Apply to Project", exact: true }).click()
    await expect(page.getByRole("button", { name: "✓ Applied to Project" })).toBeVisible()
    await expect.poll(async () => {
      const stored = await readOnlyProject(page)
      const profiles = stored.themes.flatMap(theme => theme.styleProfiles)
      const applied = profiles.find(profile => profile.name === "Applied Profile")
      return !!applied && profiles.some(profile => profile.name === "Unused Profile")
        && stored.activeStyleProfileId === applied.id
        && stored.projectMeta?.styleProfileId === applied.id
    }).toBe(true)
    const before = await readOnlyProject(page)
    const expectedProfiles = before.themes.flatMap(theme => theme.styleProfiles)
      .filter(profile => !scenario.confirm || profile.name !== scenario.target)

    if (scenario.target === "Unused Profile") {
      await page.getByRole("textbox", { name: "Search profiles…" }).click()
      await page.getByRole("button", { name: "Unused Profile Reusable", exact: true }).click()
      await expect(page.getByRole("button", { name: "Apply to Project", exact: true })).toBeVisible()
    }
    const dialogPromise = page.waitForEvent("dialog")
    const deleteClick = page.getByRole("button", { name: "Delete", exact: true }).click()
    const dialog = await dialogPromise
    const dialogType = dialog.type()
    const dialogMessage = dialog.message()
    if (scenario.confirm) await dialog.accept()
    else await dialog.dismiss()
    await deleteClick
    expect(dialogType).toBe("confirm")
    expect(dialogMessage).toBe(`Delete "${scenario.target}"?`)
    if (!scenario.confirm) {
      await expect(page.getByRole("textbox", { name: "Search profiles…" })).toHaveValue(scenario.target)
    }

    const expectPreservedState = async () => {
      await expect.poll(async () => {
        const stored = await readOnlyProject(page)
        return {
          activeStyleProfileId: stored.activeStyleProfileId,
          projectMeta: stored.projectMeta,
          profiles: stored.themes.flatMap(theme => theme.styleProfiles),
        }
      }).toEqual({
        activeStyleProfileId: before.activeStyleProfileId,
        projectMeta: before.projectMeta,
        profiles: expectedProfiles,
      })
    }
    const expectProfilesInUI = async () => {
      // The picker closes on a delayed blur; retry opening if that close is still pending.
      await expect(async () => {
        await page.getByRole("textbox", { name: "Search profiles…" }).click()
        await expect(page.getByRole("button", { name: "Unused Profile Reusable", exact: true }))
          .toHaveCount(scenario.confirm ? 0 : 1, { timeout: 1_000 })
        await page.getByRole("button", { name: "Applied Profile Applied Reusable", exact: true })
          .click({ timeout: 1_000 })
      }).toPass({ timeout: 5_000 })
      await expect(page.getByRole("textbox", { name: "Search profiles…" })).toHaveValue("Applied Profile")
      await expect(page.getByRole("button", { name: "✓ Applied to Project" })).toBeVisible()
    }
    await expectProfilesInUI()
    await expectPreservedState()

    await page.reload()
    await expect(page.getByText("Sources", { exact: true }).first()).toBeVisible()
    await page.getByRole("button", { name: /Theme$/ }).click()
    await expect(page.getByRole("textbox", { name: "Search profiles…" })).toHaveValue("Applied Profile")
    await expect(page.getByRole("button", { name: "✓ Applied to Project" })).toBeVisible()
    await expectProfilesInUI()
    await expectPreservedState()
  })
}

for (const persistedId of [undefined, "missing-style-profile"]) {
test(`falls back safely when the persisted style profile ID is ${persistedId === undefined ? "missing" : "invalid"}`, async ({
  page,
}) => {
  const projectName = `Style ID Fallback ${Date.now()}`
  const profileName = `Fallback Profile ${Date.now()}`
  await createProject(page, projectName)

  await page.getByRole("button", { name: "+ New" }).click()
  const createProfile = page.getByRole("heading", {
    name: "Create Brand & Style Profile",
  }).locator("..")
  await createProfile.getByRole("textbox").fill(profileName)
  await createProfile.getByRole("button", { name: "Create" }).click()
  await page.getByRole("button", { name: "Apply to Project" }).click()
  await expect
    .poll(async () => {
      const stored = await readOnlyProject(page)
      return stored.themes
        .flatMap((theme) => theme.styleProfiles)
        .some((profile) => profile.name === profileName)
    })
    .toBe(true)
  await page.getByRole("button", { name: /Content Studio/ }).click()

    await updateOnlyProject(page, (project) => ({
      ...project,
      activeStyleProfileId: persistedId,
      projectMeta: { ...project.projectMeta, styleProfileId: persistedId },
    }))
    await page.reload()
    await expect(page.getByText("Sources", { exact: true }).first()).toBeVisible()
    await page.getByRole("button", { name: /Theme$/ }).click()
    await expect(
      page.getByRole("heading", { name: "Theme & Style Profiles" }),
    ).toBeVisible()
    await expect(
      page.getByRole("textbox", { name: "Search profiles…" }),
    ).toHaveValue(profileName)
    await expect(
      page.getByRole("button", { name: "Apply to Project" }),
    ).toBeVisible()
    await page.getByRole("button", { name: "Apply to Project" }).click()
    await expect(
      page.getByRole("button", { name: "✓ Applied to Project" }),
    ).toBeVisible()
    await expect.poll(async () => {
      const stored = await readOnlyProject(page)
      const profile = stored.themes.flatMap(theme => theme.styleProfiles)
        .find(profile => profile.name === profileName)
      return !!profile && stored.activeStyleProfileId === profile.id
        && stored.projectMeta?.styleProfileId === profile.id
    }).toBe(true)
    await page.reload()
    await expect(page.getByText("Sources", { exact: true }).first()).toBeVisible()
    await page.getByRole("button", { name: /Theme$/ }).click()
    await expect(page.getByRole("textbox", { name: "Search profiles…" })).toHaveValue(profileName)
    await expect(page.getByRole("button", { name: "✓ Applied to Project" })).toBeVisible()
    await page.getByRole("button", { name: "Sources", exact: true }).click()
})
}