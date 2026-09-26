import { expect, test, type Page } from "@playwright/test"

type StoredProject = {
  projectId: string
  projectName: string
  activeStyleProfileId?: string
  projectMeta?: Record<string, unknown>
  themes: Array<{
    id?: string
    brandProfiles?: Array<Record<string, unknown>>
    styleProfiles: Array<Record<string, unknown>>
  }>
  pageLayouts: Array<Record<string, unknown>>
  htmlMasterPages: Array<Record<string, unknown>>
  appToc?: Array<{
    id: number
    title: string
    level: 1 | 2 | 3 | 4
    words: number
    parentId?: number
  }>
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
      const request = indexedDB.open("docflow-db", 3)
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
      const request = indexedDB.open("docflow-db", 3)
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

  await page.locator("header").getByRole("button", { name: /^Brand & Output/ }).click()
  await expect(page.getByRole("textbox", { name: "Search profiles…" })).toHaveValue(
    profileName,
  )
  await expect(
    page.getByRole("button", { name: "✓ Applied to Project" }),
  ).toBeVisible()
})

test("edits a duplicated profile independently and preserves both styles across reload", async ({
  page,
}) => {
  test.setTimeout(60_000)
  await createProject(page, `Independent Profiles ${Date.now()}`)
  const originalName = "Original Styled Profile"
  const copyName = "Independent Styled Copy"
  const originalStyle = {
    primaryColor: "#C2410C",
    headingFont: "Georgia",
    bodyFont: "Verdana",
  }
  const copyStyle = {
    primaryColor: "#0369A1",
    headingFont: "Arial",
    bodyFont: "Tahoma",
  }
  const editStyle = async (style: typeof originalStyle) => {
    await page.getByRole("button", { name: "Colors", exact: true }).click()
    const primaryRow = page.getByText("Primary", { exact: true }).locator("..")
    await primaryRow.getByRole("button").first().click()
    await primaryRow.locator("input").fill(style.primaryColor)
    await primaryRow.getByRole("button", { name: "Apply", exact: true }).click()
    await page.getByRole("button", { name: "Save Colors" }).click()
    await page.getByRole("button", { name: "Typography", exact: true }).click()
    await chooseFont(page, "Heading Font", style.headingFont)
    await chooseFont(page, "Body Font", style.bodyFont)
    await page.getByRole("button", { name: "Save Typography" }).click()
  }
  const expectStyleInUI = async (style: typeof originalStyle) => {
    await page.getByRole("button", { name: "Colors", exact: true }).click()
    await expect(page.getByText("Primary", { exact: true }).locator(".."))
      .toContainText(style.primaryColor)
    await page.getByRole("button", { name: "Typography", exact: true }).click()
    for (const [section, font] of [
      ["Heading Font", style.headingFont],
      ["Body Font", style.bodyFont],
    ]) {
      await expect(page.getByText(section, { exact: true }).locator("..").locator("..")
        .getByRole("button").first()).toContainText(font)
    }
  }
  const selectProfile = async (name: string, applied: boolean) => {
    await expect(async () => {
      await page.getByRole("textbox", { name: "Search profiles…" }).click()
      await page.getByRole("button", {
        name: `${name} ${name === originalName ? originalStyle.headingFont : copyStyle.headingFont}${applied ? " Applied" : ""} Reusable`, exact: true,
      }).click({ timeout: 1_000 })
    }).toPass({ timeout: 5_000 })
    await expect(page.getByRole("textbox", { name: "Search profiles…" })).toHaveValue(name)
    await expect(page.getByRole("button", {
      name: applied ? "✓ Applied to Project" : "Apply to Project", exact: true,
    })).toBeVisible()
  }

  await page.getByRole("button", { name: "+ New" }).click()
  const createModal = page.getByRole("heading", {
    name: "Create Brand & Style Profile",
  }).locator("..")
  await createModal.getByRole("textbox").fill(originalName)
  await createModal.getByRole("button", { name: "Create", exact: true }).click()
  await editStyle(originalStyle)
  await page.getByRole("button", { name: "Apply to Project", exact: true }).click()
  await expect.poll(async () => {
    const stored = await readOnlyProject(page)
    const original = stored.themes.flatMap(theme => theme.styleProfiles)
      .find(profile => profile.name === originalName)
    return !!original && stored.activeStyleProfileId === original.id
      && stored.projectMeta?.styleProfileId === original.id
  }).toBe(true)
  const before = await readOnlyProject(page)
  const original = before.themes.flatMap(theme => theme.styleProfiles)
    .find(profile => profile.name === originalName)!
  expect(original).toMatchObject(originalStyle)

  await page.getByRole("button", { name: "Duplicate", exact: true }).click()
  const duplicateModal = page.getByRole("heading", { name: "Duplicate Profile" }).locator("..")
  await expect(duplicateModal.getByRole("textbox")).toHaveValue(`${originalName} — Copy`)
  await duplicateModal.getByRole("textbox").fill(copyName)
  await duplicateModal.getByRole("button", { name: "Duplicate", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Search profiles…" })).toHaveValue(copyName)
  await expect(page.getByRole("button", { name: "Apply to Project", exact: true })).toBeVisible()
  await expect.poll(async () => {
    const stored = await readOnlyProject(page)
    return stored.themes.flatMap(theme => theme.styleProfiles)
      .find(profile => profile.name === copyName)
  }).toMatchObject({
    ...original, id: expect.any(String), name: copyName, source: `Based on ${originalName}`,
  })
  const duplicated = (await readOnlyProject(page)).themes.flatMap(theme => theme.styleProfiles)
    .find(profile => profile.name === copyName)!
  expect(duplicated.id).not.toBe(original.id)
  await expectStyleInUI(originalStyle)
  await editStyle(copyStyle)
  await expect.poll(async () => {
    const stored = await readOnlyProject(page)
    return stored.themes.flatMap(theme => theme.styleProfiles)
      .find(profile => profile.id === duplicated.id)
  }).toMatchObject({
    ...copyStyle,
    h1: expect.objectContaining({ fontFamily: copyStyle.headingFont }),
    body: expect.objectContaining({ fontFamily: copyStyle.bodyFont }),
  })
  const editedCopy = (await readOnlyProject(page)).themes.flatMap(theme => theme.styleProfiles)
    .find(profile => profile.id === duplicated.id)!

  const expectStoredState = async (appliedId: unknown) => {
    await expect.poll(async () => {
      const stored = await readOnlyProject(page)
      return {
        profiles: stored.themes.flatMap(theme => theme.styleProfiles),
        activeStyleProfileId: stored.activeStyleProfileId,
        projectMeta: stored.projectMeta,
      }
    }).toEqual({
      profiles: [...before.themes.flatMap(theme => theme.styleProfiles), editedCopy],
      activeStyleProfileId: appliedId,
      projectMeta: { ...before.projectMeta, styleProfileId: appliedId },
    })
  }
  const reloadTheme = async () => {
    await page.reload()
    await expect(page.getByText("Sources", { exact: true }).first()).toBeVisible()
    await page.locator("header").getByRole("button", { name: /^Brand & Output/ }).click()
  }

  await expectStoredState(original.id)
  await selectProfile(originalName, true)
  await expectStyleInUI(originalStyle)
  await selectProfile(copyName, false)
  await expectStyleInUI(copyStyle)
  await expectStoredState(original.id)

  await reloadTheme()
  await expect(page.getByRole("textbox", { name: "Search profiles…" })).toHaveValue(originalName)
  await selectProfile(originalName, true)
  await expectStyleInUI(originalStyle)
  await selectProfile(copyName, false)
  await expectStyleInUI(copyStyle)
  await expectStoredState(original.id)

  await page.getByRole("button", { name: "Apply to Project", exact: true }).click()
  await expect(page.getByRole("button", { name: "✓ Applied to Project" })).toBeVisible()
  await expectStoredState(duplicated.id)
  await reloadTheme()
  await expect(page.getByRole("textbox", { name: "Search profiles…" })).toHaveValue(copyName)
  await selectProfile(copyName, true)
  await expectStyleInUI(copyStyle)
  await selectProfile(originalName, false)
  await expectStyleInUI(originalStyle)
  await expectStoredState(duplicated.id)
})

test("falls back to a remaining profile when the applied profile is deleted", async ({
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
  await expect(page.getByRole("button", { name: "✓ Applied to Project", exact: true })).toBeVisible()
  const expectFallbackApplied = async () => {
    await expect.poll(async () => {
      const stored = await readOnlyProject(page)
      const profiles = stored.themes.flatMap(theme => theme.styleProfiles)
      const remaining = profiles.find(profile => profile.name === "Remaining Profile")
      return !!remaining
        && stored.activeStyleProfileId === remaining.id
        && stored.projectMeta?.styleProfileId === remaining.id
        && !profiles.some(profile => profile.name === "Applied Profile")
    }).toBe(true)
  }
  await expectFallbackApplied()

  await page.reload()
  await expect(page.getByText("Sources", { exact: true }).first()).toBeVisible()
  await page.locator("header").getByRole("button", { name: /^Brand & Output/ }).click()
  await expect(page.getByRole("textbox", { name: "Search profiles…" })).toHaveValue("Remaining Profile")
  await expect(page.getByRole("button", { name: "✓ Applied to Project" })).toBeVisible()
  await expectFallbackApplied()
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
    await page.locator("header").getByRole("button", { name: /^Brand & Output/ }).click()
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
    await page.locator("header").getByRole("button", { name: /^Brand & Output/ }).click()
    await expect(
      page.getByRole("heading", { name: "Theme & Style Profiles" }),
    ).toBeVisible()
    await expect(
      page.getByRole("textbox", { name: "Search profiles…" }),
    ).toHaveValue(profileName)
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
    await page.locator("header").getByRole("button", { name: /^Brand & Output/ }).click()
    await expect(page.getByRole("textbox", { name: "Search profiles…" })).toHaveValue(profileName)
    await expect(page.getByRole("button", { name: "✓ Applied to Project" })).toBeVisible()
  await page.locator("header").getByRole("button", { name: /^Sources,/ }).click()
})
}

test("resolves rich profiles by project, active, then active-theme priority across reloads", async ({
  page,
}) => {
  const projectName = `Profile Resolution ${Date.now()}`
  await createProject(page, projectName)

  for (const name of ["Theme Priority Profile", "Project Priority Profile"]) {
    await page.getByRole("button", { name: "+ New" }).click()
    const modal = page.getByRole("heading", {
      name: "Create Brand & Style Profile",
    }).locator("..")
    await modal.getByRole("textbox").fill(name)
    await modal.getByRole("button", { name: "Create", exact: true }).click()
  }

  await expect.poll(async () => {
    const profiles = (await readOnlyProject(page)).themes.flatMap(theme => theme.styleProfiles)
    return profiles.filter(profile =>
      ["Theme Priority Profile", "Project Priority Profile"].includes(String(profile.name)),
    ).length
  }).toBe(2)
  await page.getByRole("button", { name: /Content Studio/ }).click()

  const stored = await readOnlyProject(page)
  const profiles = stored.themes.flatMap(theme => theme.styleProfiles)
  const themePriority = profiles.find(profile => profile.name === "Theme Priority Profile")!
  const projectPriority = profiles.find(profile => profile.name === "Project Priority Profile")!

  const expectSelectedAfterReload = async (name: string, expectedId: string) => {
    await page.reload()
    await expect(page.getByText("Sources", { exact: true }).first()).toBeVisible()
    await page.locator("header").getByRole("button", { name: /^Brand & Output/ }).click()
    await expect(
      page.getByRole("textbox", { name: "Search profiles…" }),
    ).toHaveValue(name)
    await expect(
      page.getByRole("button", { name: "✓ Applied to Project" }),
    ).toBeVisible()
    await expect.poll(async () => {
      const reloaded = await readOnlyProject(page)
      return {
        projectProfileId: reloaded.projectMeta?.styleProfileId,
        legacyProfileId: reloaded.activeStyleProfileId,
      }
    }).toEqual({
      projectProfileId: expectedId,
      legacyProfileId: expectedId,
    })
    await page.locator("header").getByRole("button", { name: /^Sources,/ }).click()
  }

  await updateOnlyProject(page, project => ({
    ...project,
    activeStyleProfileId: String(themePriority.id),
    projectMeta: {
      ...project.projectMeta,
      styleProfileId: String(projectPriority.id),
    },
  }))
  await expectSelectedAfterReload("Project Priority Profile", String(projectPriority.id))

  await updateOnlyProject(page, project => ({
    ...project,
    activeStyleProfileId: String(themePriority.id),
    projectMeta: {
      ...project.projectMeta,
      styleProfileId: "invalid-project-profile",
    },
  }))
  await expectSelectedAfterReload("Theme Priority Profile", String(themePriority.id))

  await updateOnlyProject(page, project => ({
    ...project,
    activeStyleProfileId: "invalid-active-profile",
    projectMeta: {
      ...project.projectMeta,
      styleProfileId: "",
    },
  }))
  await expectSelectedAfterReload("Theme Priority Profile", String(themePriority.id))

  const reloaded = await readOnlyProject(page)
  expect(reloaded.pageLayouts).toEqual(stored.pageLayouts)
  expect(reloaded.htmlMasterPages).toEqual(stored.htmlMasterPages)
})

test("page layouts inherit the applied profile while preserving and resetting local overrides", async ({
  page,
}) => {
  test.setTimeout(90_000)
  await createProject(page, `Layout Brand Inheritance ${Date.now()}`)

  const profiles = [
    { name: "Layout Brand A", primaryColor: "#C2410C", headingFont: "Georgia", bodyFont: "Verdana" },
    { name: "Layout Brand B", primaryColor: "#0369A1", headingFont: "Arial", bodyFont: "Tahoma" },
  ]

  const createStyledProfile = async (profile: typeof profiles[number]) => {
    await page.getByRole("button", { name: "+ New" }).click()
    const modal = page.getByRole("heading", {
      name: "Create Brand & Style Profile",
    }).locator("..")
    await modal.getByRole("textbox").fill(profile.name)
    await modal.getByRole("button", { name: "Create", exact: true }).click()

    await page.getByRole("button", { name: "Colors", exact: true }).click()
    const primaryRow = page.getByText("Primary", { exact: true }).locator("..")
    await primaryRow.getByRole("button").first().click()
    await primaryRow.locator("input").fill(profile.primaryColor)
    await primaryRow.getByRole("button", { name: "Apply", exact: true }).click()
    await page.getByRole("button", { name: "Save Colors" }).click()

    await page.getByRole("button", { name: "Typography", exact: true }).click()
    await chooseFont(page, "Heading Font", profile.headingFont)
    await chooseFont(page, "Body Font", profile.bodyFont)
    await page.getByRole("button", { name: "Save Typography" }).click()
  }

  const selectAndApplyProfile = async (profile: typeof profiles[number]) => {
    await page.getByRole("textbox", { name: "Search profiles…" }).click()
    await page.getByRole("button", { name: new RegExp(`^${profile.name}`) }).click()
    await page.getByRole("button", { name: "Apply to Project", exact: true }).click()
    await expect(page.getByRole("button", { name: "✓ Applied to Project" })).toBeVisible()
  }

  const expectLayoutPreview = async (profile: typeof profiles[number], background: string) => {
    const preview = page.getByTestId("page-layout-preview")
    await expect(preview).toHaveAttribute("data-background-color", background)
    await expect(preview).toHaveAttribute("data-heading-color", /^#[0-9A-Fa-f]{6}$/)
    await expect(preview).toHaveAttribute("data-heading-font", profile.headingFont)
    await expect(preview).toHaveAttribute("data-body-font", profile.bodyFont)
  }

  await createStyledProfile(profiles[0])
  await page.getByRole("button", { name: "Apply to Project", exact: true }).click()
  await page.getByRole("button", { name: "Output Templates", exact: true }).click()
  await expect(page.getByTestId("layout-background-source")).toHaveText("Inherited from Brand")
  await expectLayoutPreview(profiles[0], profiles[0].primaryColor)

  await page.getByRole("button", { name: "Brand & Style", exact: true }).click()
  await createStyledProfile(profiles[1])
  await page.getByRole("button", { name: "Apply to Project", exact: true }).click()
  await page.getByRole("button", { name: "Output Templates", exact: true }).click()
  await expectLayoutPreview(profiles[1], profiles[1].primaryColor)

  await page.getByTitle(`Use Primary (${profiles[1].primaryColor})`).click()
  await expect(page.getByTestId("layout-background-source")).toHaveText("Layout override")

  await page.getByRole("button", { name: "Brand & Style", exact: true }).click()
  await selectAndApplyProfile(profiles[0])
  await page.getByRole("button", { name: "Output Templates", exact: true }).click()
  await expectLayoutPreview(profiles[0], profiles[1].primaryColor)
  await expect.poll(async () => {
    const stored = await readOnlyProject(page)
    const active = stored.themes.flatMap(theme => theme.styleProfiles)
      .find(profile => profile.id === stored.activeStyleProfileId)
    return {
      overrides: stored.pageLayouts.find(layout => layout.layoutType === "cover")?.brandOverrides,
      activeName: active?.name,
    }
  }).toEqual({ overrides: { bgColor: profiles[1].primaryColor }, activeName: profiles[0].name })

  await page.reload()
  await expect(page.getByText("Sources", { exact: true }).first()).toBeVisible()
  await page.locator("header").getByRole("button", { name: /^Brand & Output/ }).click()
  await page.getByRole("button", { name: "Output Templates", exact: true }).click()
  await expect(page.getByTestId("layout-background-source")).toHaveText("Layout override")
  await expectLayoutPreview(profiles[0], profiles[1].primaryColor)

  await page.getByRole("button", { name: "Reset to Brand", exact: true }).click()
  await expect(page.getByTestId("layout-background-source")).toHaveText("Inherited from Brand")
  await expectLayoutPreview(profiles[0], profiles[0].primaryColor)
  await expect.poll(async () => {
    const stored = await readOnlyProject(page)
    return stored.pageLayouts.find(layout => layout.layoutType === "cover")?.brandOverrides
  }).toEqual({})

  await page.reload()
  await expect(page.getByText("Sources", { exact: true }).first()).toBeVisible()
  await page.locator("header").getByRole("button", { name: /^Brand & Output/ }).click()
  await page.getByRole("button", { name: "Output Templates", exact: true }).click()
  await expect(page.getByTestId("layout-background-source")).toHaveText("Inherited from Brand")
  await expectLayoutPreview(profiles[0], profiles[0].primaryColor)

  const stored = await readOnlyProject(page)
  const cover = stored.pageLayouts.find(layout => layout.layoutType === "cover")
  expect(cover?.brandOverrides).toEqual({})
})

test("HTML masters inherit applied Brand styling and preserve resettable block overrides", async ({
  page,
}) => {
  test.setTimeout(90_000)
  await createProject(page, `HTML Master Brand Inheritance ${Date.now()}`)

  const profiles = [
    { name: "HTML Brand A", primaryColor: "#A21CAF", headingFont: "Georgia", bodyFont: "Verdana" },
    { name: "HTML Brand B", primaryColor: "#0E7490", headingFont: "Arial", bodyFont: "Tahoma" },
  ]

  const createStyledProfile = async (profile: typeof profiles[number]) => {
    await page.getByRole("button", { name: "+ New" }).click()
    const modal = page.getByRole("heading", {
      name: "Create Brand & Style Profile",
    }).locator("..")
    await modal.getByRole("textbox").fill(profile.name)
    await modal.getByRole("button", { name: "Create", exact: true }).click()
    await page.getByRole("button", { name: "Colors", exact: true }).click()
    const primaryRow = page.getByText("Primary", { exact: true }).locator("..")
    await primaryRow.getByRole("button").first().click()
    await primaryRow.locator("input").fill(profile.primaryColor)
    await primaryRow.getByRole("button", { name: "Apply", exact: true }).click()
    await page.getByRole("button", { name: "Save Colors" }).click()
    await page.getByRole("button", { name: "Typography", exact: true }).click()
    await chooseFont(page, "Heading Font", profile.headingFont)
    await chooseFont(page, "Body Font", profile.bodyFont)
    await page.getByRole("button", { name: "Save Typography" }).click()
  }

  const selectAndApplyProfile = async (profile: typeof profiles[number]) => {
    await page.getByRole("textbox", { name: "Search profiles…" }).click()
    await page.getByRole("button", { name: new RegExp(`^${profile.name}`) }).click()
    await page.getByRole("button", { name: "Apply to Project", exact: true }).click()
  }

  const openHtmlMasters = async () => {
    await page.getByRole("button", { name: "Output Templates", exact: true }).click()
    await page.getByRole("button", { name: "HTML Master Pages", exact: true }).click()
  }

  const expectMasterPreview = async (profile: typeof profiles[number], headerColor: string) => {
    const preview = page.getByTestId("html-master-preview")
    await expect(preview).toHaveAttribute("data-header-background", new RegExp(`^${headerColor}$`, "i"))
    await expect(preview).toHaveAttribute("data-heading-font", profile.headingFont)
    await expect(preview).toHaveAttribute("data-body-font", profile.bodyFont)
    await expect(preview).toHaveAttribute("data-link-color", /^#[0-9A-Fa-f]{6}$/)
    await expect(preview).toHaveAttribute("data-border-color", /^#[0-9A-Fa-f]{6}$/)
  }

  await createStyledProfile(profiles[0])
  await page.getByRole("button", { name: "Apply to Project", exact: true }).click()
  await openHtmlMasters()
  await expectMasterPreview(profiles[0], profiles[0].primaryColor)
  await page.getByTestId("html-master-header").click()
  await expect(page.getByTestId("html-header-background-source")).toHaveText("Inherited from Brand")

  await page.getByRole("button", { name: "Brand & Style", exact: true }).click()
  await createStyledProfile(profiles[1])
  await page.getByRole("button", { name: "Apply to Project", exact: true }).click()
  await openHtmlMasters()
  await expectMasterPreview(profiles[1], profiles[1].primaryColor)

  await page.getByTestId("html-header-background-input").fill("#B45309")
  await expect(page.getByTestId("html-header-background-source")).toHaveText("Block override")
  await expectMasterPreview(profiles[1], "#B45309")

  await page.getByRole("button", { name: "Brand & Style", exact: true }).click()
  await selectAndApplyProfile(profiles[0])
  await openHtmlMasters()
  await expectMasterPreview(profiles[0], "#B45309")
  await expect.poll(async () => {
    const stored = await readOnlyProject(page)
    const home = stored.htmlMasterPages.find(master => master.masterType === "home")
    const blocks = home?.blocks as Array<{ id: string; props?: Record<string, unknown> }> | undefined
    const appliedProfile = stored.themes
      .flatMap(theme => theme.styleProfiles)
      .find(profile => profile.name === profiles[0].name)
    return {
      headerColor: blocks?.find(block => block.id === "header")?.props?.bgColor,
      applied: stored.projectMeta?.styleProfileId === appliedProfile?.id,
    }
  }).toEqual({ headerColor: "#b45309", applied: true })

  await page.reload()
  await expect(page.getByText("Sources", { exact: true }).first()).toBeVisible()
  await page.locator("header").getByRole("button", { name: /^Brand & Output/ }).click()
  await openHtmlMasters()
  await expectMasterPreview(profiles[0], "#B45309")
  await page.getByTestId("html-master-header").click()
  await expect(page.getByTestId("html-header-background-source")).toHaveText("Block override")

  await page.getByRole("button", { name: "Reset to Brand", exact: true }).click()
  await expect(page.getByTestId("html-header-background-source")).toHaveText("Inherited from Brand")
  await expectMasterPreview(profiles[0], profiles[0].primaryColor)

  await expect.poll(async () => {
    const stored = await readOnlyProject(page)
    const home = stored.htmlMasterPages.find(master => master.masterType === "home")
    const blocks = home?.blocks as Array<{ id: string; props?: Record<string, unknown> }> | undefined
    return blocks?.find(block => block.id === "header")?.props?.bgColor ?? null
  }).toBeNull()

  await page.reload()
  await expect(page.getByText("Sources", { exact: true }).first()).toBeVisible()
  await page.locator("header").getByRole("button", { name: /^Brand & Output/ }).click()
  await openHtmlMasters()
  await expectMasterPreview(profiles[0], profiles[0].primaryColor)
})

test("navigation cards bind to stable central TOC topic IDs and report missing topics", async ({
  page,
}) => {
  test.setTimeout(90_000)
  await createProject(page, `Navigation Card Topics ${Date.now()}`)

  const legacyCards = [
    { id: "c1", title: "Start Here", desc: "Legacy introduction card", icon: "🚀" },
    { id: "c2", title: "API Reference", desc: "Legacy API description", icon: "📖" },
  ]
  await updateOnlyProject(page, project => ({
    ...project,
    appToc: [
      { id: 101, title: "Getting Started", level: 1, words: 300 },
      { id: 202, title: "Install the Product", level: 2, words: 180, parentId: 101 },
    ],
    htmlMasterPages: project.htmlMasterPages.map(master => master.masterType === "home"
      ? {
          ...master,
          blocks: [
            { id: "header", type: "header", label: "Header" },
            {
              id: "cards",
              type: "cards",
              label: "Navigation Cards",
              props: { title: "Browse Documentation", columns: 2, cards: legacyCards },
            },
            { id: "footer", type: "footer", label: "Footer" },
          ],
        }
      : master),
  }))

  const openHtmlMasters = async () => {
    await page.getByRole("button", { name: "Output Templates", exact: true }).click()
    await page.getByRole("button", { name: "HTML Master Pages", exact: true }).click()
  }

  await page.reload()
  await expect(page.getByText("Sources", { exact: true }).first()).toBeVisible()
  await page.locator("header").getByRole("button", { name: /^Brand & Output/ }).click()
  await openHtmlMasters()

  const legacyPreview = page.getByTestId("navigation-card-preview-c2")
  await expect(legacyPreview).toContainText("API Reference")
  await expect(legacyPreview).toContainText("Legacy API description")
  await expect(legacyPreview).toHaveAttribute("data-destination-type", "none")
  await expect(legacyPreview).toHaveAttribute("data-link-state", "valid")

  await page.getByTestId("navigation-cards-block").click()
  await page.getByLabel("Card 1 destination type").selectOption("topic")
  await page.getByLabel("Card 1 topic").selectOption("202")

  const linkedPreview = page.getByTestId("navigation-card-preview-c1")
  await expect(linkedPreview).toHaveAttribute("data-topic-id", "202")
  await expect(linkedPreview).toHaveAttribute("data-link-state", "valid")
  await expect(linkedPreview).toContainText("Getting Started › Install the Product")
  await expect(linkedPreview).toContainText("Start Here")
  await expect(linkedPreview).toContainText("Legacy introduction card")

  await expect.poll(async () => {
    const stored = await readOnlyProject(page)
    const home = stored.htmlMasterPages.find(master => master.masterType === "home")
    const blocks = home?.blocks as Array<{ id: string; type: string; props?: { cards?: Array<Record<string, unknown>> } }> | undefined
    const cardBlock = blocks?.find(block => block.id === "cards")
    return {
      blockType: cardBlock?.type,
      first: cardBlock?.props?.cards?.[0],
      second: cardBlock?.props?.cards?.[1],
    }
  }).toEqual({
    blockType: "navigation-cards",
    first: {
      ...legacyCards[0],
      destinationType: "topic",
      topicId: 202,
    },
    second: legacyCards[1],
  })

  await updateOnlyProject(page, project => ({
    ...project,
    appToc: project.appToc?.map(item => item.id === 202
      ? { ...item, title: "Install and Configure" }
      : item),
  }))
  await page.reload()
  await expect(page.getByText("Sources", { exact: true }).first()).toBeVisible()
  await page.locator("header").getByRole("button", { name: /^Brand & Output/ }).click()
  await openHtmlMasters()
  await expect(page.getByTestId("navigation-card-preview-c1")).toContainText("Getting Started › Install and Configure")
  await expect(page.getByTestId("navigation-card-preview-c1")).toHaveAttribute("data-topic-id", "202")

  await updateOnlyProject(page, project => ({
    ...project,
    appToc: project.appToc?.filter(item => item.id !== 202),
  }))
  await page.reload()
  await expect(page.getByText("Sources", { exact: true }).first()).toBeVisible()
  await page.locator("header").getByRole("button", { name: /^Brand & Output/ }).click()
  await openHtmlMasters()

  const brokenPreview = page.getByTestId("navigation-card-preview-c1")
  await expect(brokenPreview).toHaveAttribute("data-link-state", "broken")
  await expect(brokenPreview).toContainText("Broken link")
  await expect(brokenPreview).toContainText("Missing topic (ID 202)")
  await page.getByTestId("navigation-cards-block").click()
  await expect(page.getByTestId("navigation-card-broken-c1")).toContainText("Referenced topic ID 202 no longer exists")

  const stored = await readOnlyProject(page)
  const home = stored.htmlMasterPages.find(master => master.masterType === "home")
  const blocks = home?.blocks as Array<{ id: string; props?: { cards?: Array<Record<string, unknown>> } }> | undefined
  const cards = blocks?.find(block => block.id === "cards")?.props?.cards
  expect(cards?.[0]).toEqual({ ...legacyCards[0], destinationType: "topic", topicId: 202 })
  expect(cards?.[1]).toEqual(legacyCards[1])
})