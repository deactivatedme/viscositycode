// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
package com.poracode.app.ui.theme

import androidx.compose.ui.graphics.Color
import kotlin.math.abs
import kotlin.math.roundToInt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Guards the generated Android theme presets. The expected `default` literals pin
 * the generated palette within 1/255 per channel.
 * ViscosityCode: the default is the fork's monochrome palette, not upstream indigo.
 */
class PoracodeThemePresetsTest {

    @Test
    fun defaultPresetMatchesTheHandTunedPaletteWithinOneByte() {
        // ViscosityCode: "default" is the monochrome preset, not the fresh-install selection.
        val preset = poracodeThemePreset("default")
        assertEquals("default", preset.id)
        assertChannels(preset.light, EXPECTED_LIGHT)
        assertChannels(preset.dark, EXPECTED_DARK)
    }

    @Test
    fun freshSelectionIsViscosityBlueWhileStoredDefaultStaysMonochrome() {
        // ViscosityCode: absent/unknown ids select Viscosity Blue; a stored "default" is kept.
        assertEquals("viscosity-blue", DEFAULT_PORACODE_THEME_ID)
        assertEquals("viscosity-blue", poracodeThemePreset(null).id)
        assertEquals("default", normalizeThemeId("default"))
        assertEquals("Viscosity", poracodeThemePreset("default").label)
    }

    @Test
    fun normalizeThemeIdMapsLegacyAliasAndFallsBackToDefault() {
        assertEquals("poracode-legacy", normalizeThemeId("lightcode-legacy"))
        assertEquals("poracode-legacy", normalizeThemeId("poracode-legacy"))
        assertEquals("dracula", normalizeThemeId("dracula"))
        assertEquals(DEFAULT_PORACODE_THEME_ID, normalizeThemeId("does-not-exist"))
        assertEquals(DEFAULT_PORACODE_THEME_ID, normalizeThemeId(null))
        assertEquals(DEFAULT_PORACODE_THEME_ID, normalizeThemeId(""))
    }

    @Test
    fun poracodeThemePresetResolvesKnownAndUnknownIds() {
        assertEquals("dracula", poracodeThemePreset("dracula").id)
        assertEquals(DEFAULT_PORACODE_THEME_ID, poracodeThemePreset("bogus").id)
        assertEquals(DEFAULT_PORACODE_THEME_ID, poracodeThemePreset(null).id)
        // Legacy alias resolves to the poracode-legacy preset, not default.
        assertEquals("poracode-legacy", poracodeThemePreset("lightcode-legacy").id)
    }

    @Test
    fun everyPresetHasBothVariants() {
        PoracodeThemePresets.forEach { preset ->
            // ViscosityCode: Hostile Binary is dark-only; its light slot is the dark variant.
            if (preset.id == "hostile-binary") assertEquals(preset.dark, preset.light)
            else assertTrue(preset.light.isDark.not())
            assertTrue(preset.dark.isDark)
            assertTrue(preset.label.isNotBlank())
        }
    }

    private fun assertChannels(actual: PoracodeColors, expected: Map<String, Int>) {
        val fields = argbByName(actual)
        assertEquals(expected.keys, fields.keys)
        for ((name, want) in expected) {
            val got = fields.getValue(name)
            for (channel in 0..3) {
                val diff = abs(((want shr (channel * 8)) and 0xFF) - ((got shr (channel * 8)) and 0xFF))
                assertTrue(
                    "$name channel $channel: got ${hex(got)} want ${hex(want)}",
                    diff <= 1,
                )
            }
        }
    }

    /** Packed ARGB (alpha in the high byte) for every color field, keyed by field name. */
    private fun argbByName(c: PoracodeColors): Map<String, Int> = mapOf(
        "background" to c.background.argb(),
        "foreground" to c.foreground.argb(),
        "muted" to c.muted.argb(),
        "surface" to c.surface.argb(),
        "surfaceSecondary" to c.surfaceSecondary.argb(),
        "surfaceTertiary" to c.surfaceTertiary.argb(),
        "overlay" to c.overlay.argb(),
        "listRow" to c.listRow.argb(),
        "glass" to c.glass.argb(),
        "composerSurface" to c.composerSurface.argb(),
        "default" to c.default.argb(),
        "accent" to c.accent.argb(),
        "accentForeground" to c.accentForeground.argb(),
        "accentSoft" to c.accentSoft.argb(),
        "accentSoftForeground" to c.accentSoftForeground.argb(),
        "success" to c.success.argb(),
        "successForeground" to c.successForeground.argb(),
        "warning" to c.warning.argb(),
        "warningForeground" to c.warningForeground.argb(),
        "danger" to c.danger.argb(),
        "dangerForeground" to c.dangerForeground.argb(),
        "fieldBackground" to c.fieldBackground.argb(),
        "fieldPlaceholder" to c.fieldPlaceholder.argb(),
        "fieldBorder" to c.fieldBorder.argb(),
        "segment" to c.segment.argb(),
        "border" to c.border.argb(),
        "separator" to c.separator.argb(),
        "hairline" to c.hairline.argb(),
        "hairlineStrong" to c.hairlineStrong.argb(),
        "rowActive" to c.rowActive.argb(),
        "finishedTone" to c.finishedTone.argb(),
        "prMerged" to c.prMerged.argb(),
        "gitBranchTone" to c.gitBranchTone.argb(),
        "floatingShadow" to c.floatingShadow.argb(),
        "scrim" to c.scrim.argb(),
    )

    private fun Color.argb(): Int {
        fun byte(value: Float) = (value * 255f).roundToInt().coerceIn(0, 255)
        return (byte(alpha) shl 24) or (byte(red) shl 16) or (byte(green) shl 8) or byte(blue)
    }

    private fun hex(argb: Int) = "0x" + argb.toUInt().toString(16).uppercase().padStart(8, '0')

    private companion object {
        // ViscosityCode: the fork's monochrome default (generated from themePresets.ts).
        val EXPECTED_LIGHT = mapOf(
            "background" to 0xFFFAFAFA.toInt(), "foreground" to 0xFF0A0A0A.toInt(),
            "muted" to 0xFF666666.toInt(), "surface" to 0xFFFFFFFF.toInt(),
            "surfaceSecondary" to 0xFFE8E8E8.toInt(), "surfaceTertiary" to 0xFFD5D5D5.toInt(),
            "overlay" to 0xFFEBEBEB.toInt(), "listRow" to 0xFFFFFFFF.toInt(),
            "glass" to 0xCCFFFFFF.toInt(), "composerSurface" to 0xFFFFFFFF.toInt(),
            "default" to 0xFFCCCCCC.toInt(), "accent" to 0xFF0A0A0A.toInt(),
            "accentForeground" to 0xFFFFFFFF.toInt(), "accentSoft" to 0x260A0A0A.toInt(),
            "accentSoftForeground" to 0xFF0A0A0A.toInt(), "success" to 0xFF236E44.toInt(),
            "successForeground" to 0xFFFCFCFC.toInt(), "warning" to 0xFF875814.toInt(),
            "warningForeground" to 0xFFFCFCFC.toInt(), "danger" to 0xFFA83634.toInt(),
            "dangerForeground" to 0xFFFCFCFC.toInt(), "fieldBackground" to 0xFFF1F1F1.toInt(),
            "fieldPlaceholder" to 0xFF6E6E6E.toInt(), "fieldBorder" to 0xB3E5E5E5.toInt(),
            "segment" to 0xFFFFFFFF.toInt(), "border" to 0xFFE5E5E5.toInt(),
            "separator" to 0xBFE5E5E5.toInt(), "hairline" to 0x170A0A0A.toInt(),
            "hairlineStrong" to 0x260A0A0A.toInt(), "rowActive" to 0x1C0A0A0A.toInt(),
            "finishedTone" to 0xFF3A3A3A.toInt(), "prMerged" to 0xFF645992.toInt(),
            "gitBranchTone" to 0xFF666666.toInt(), "floatingShadow" to 0x140F172A.toInt(),
            "scrim" to 0x52000000.toInt(),
        )
        val EXPECTED_DARK = mapOf(
            "background" to 0xFF000000.toInt(), "foreground" to 0xFFEDEDED.toInt(),
            "muted" to 0xFFA1A1A1.toInt(), "surface" to 0xFF111111.toInt(),
            "surfaceSecondary" to 0xFF1F1F1F.toInt(), "surfaceTertiary" to 0xFF2C2C2C.toInt(),
            "overlay" to 0xFF141414.toInt(), "listRow" to 0xFF1C1C1E.toInt(),
            "glass" to 0xFF1C1C1E.toInt(), "composerSurface" to 0xFF141414.toInt(),
            "default" to 0xFF2A2A2A.toInt(), "accent" to 0xFFFFFFFF.toInt(),
            "accentForeground" to 0xFF000000.toInt(), "accentSoft" to 0x1FFFFFFF.toInt(),
            "accentSoftForeground" to 0xFFFAFAFA.toInt(), "success" to 0xFF74C692.toInt(),
            "successForeground" to 0xFF000000.toInt(), "warning" to 0xFFE6BD77.toInt(),
            "warningForeground" to 0xFF000000.toInt(), "danger" to 0xFFE47C75.toInt(),
            "dangerForeground" to 0xFF000000.toInt(), "fieldBackground" to 0xFF1A1A1A.toInt(),
            "fieldPlaceholder" to 0xFF8A8A8A.toInt(), "fieldBorder" to 0xB3262626.toInt(),
            "segment" to 0xFF3A3A3A.toInt(), "border" to 0xFF262626.toInt(),
            "separator" to 0xBF262626.toInt(), "hairline" to 0x17EDEDED.toInt(),
            "hairlineStrong" to 0x26EDEDED.toInt(), "rowActive" to 0x33EDEDED.toInt(),
            "finishedTone" to 0xFFD1D1D1.toInt(), "prMerged" to 0xFFABA3D4.toInt(),
            "gitBranchTone" to 0xFFA1A1A1.toInt(), "floatingShadow" to 0x59000000.toInt(),
            "scrim" to 0x99000000.toInt(),
        )
    }
}
