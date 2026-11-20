// GENERATED FILE. Do not edit by hand.
package com.poracode.remote.v3.generated

import kotlinx.serialization.*
import kotlinx.serialization.descriptors.*
import kotlinx.serialization.encoding.*
import kotlinx.serialization.json.*
internal val schema_a16cb9740d19657e: RemoteSchema by lazy {
    RemoteSchema(type = "array", maxItems = 8, items = schema_d6a8cd432c4887c3, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a1f40266b6e1acfa: RemoteSchema by lazy {
    RemoteSchema(type = "string", literals = listOf(JsonPrimitive("prepare-worktree")), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a20681cb358b7044: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("project", "pullRequestKeys", "refreshedAt"), properties = mapOf("project" to schema_83470ce63973b6e2, "pullRequestKeys" to schema_0f732b9fceb2c6ac, "refreshedAt" to schema_bf0b727f7b1c6d07, "viewerLogin" to schema_bf0b727f7b1c6d07), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a26f77dd4ad13e5b: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("targetPort"), properties = mapOf("targetPort" to schema_279eee1efa9da6c8), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a2857498be68a6b2: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("projects", "runtimeSummariesByThread", "snapshotSeq", "threads", "updatedAt"), properties = mapOf("gitState" to schema_039d29a220abcf97, "gitSummariesByThread" to schema_aca97eda78815baa, "projects" to schema_71e40ca28c8b47ee, "projectsNextCursor" to schema_2d0b6ec9f2b2decf, "reads" to schema_4659e6d395f41e16, "runtimeSummariesByThread" to schema_fc9d6f4c2617a24d, "snapshotEpoch" to schema_8e43cad70cd70de7, "snapshotSeq" to schema_56aa0e45cbdce0d0, "threads" to schema_509b69ba008e0696, "threadsNextCursor" to schema_2d0b6ec9f2b2decf, "updatedAt" to schema_36fea325bf1aca70, "workspaces" to schema_15fcce03de60030d), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a36830c34a81f248: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("kind"), properties = mapOf("kind" to schema_60fc988aefaed4f5), additionalAllowed = false, unknownPolicy = RemoteUnknownFieldPolicy.REJECT)
}

internal val schema_a399fbc7541223f3: RemoteSchema by lazy {
    RemoteSchema(unionKind = "oneOf", options = listOf(schema_5ea95607826c2d23, schema_12ca2594dca47145, schema_43372628accc1dd8, schema_0e036ef4dad9c975, schema_849e43bfc063f1bb, schema_501221cdcb9cd48b, schema_1806ffb1da5fcacb), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a39dd0410456fe31: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("balance"), properties = mapOf("balance" to schema_80c415b6e27c6ebd, "currency" to schema_bf0b727f7b1c6d07, "label" to schema_bf0b727f7b1c6d07, "unlimited" to schema_feeb8bb50144d96d), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a3e9394f18b82504: RemoteSchema by lazy {
    RemoteSchema(type = "string", literals = listOf(JsonPrimitive("callTool")), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a412a228f3b07cd3: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("details"), properties = mapOf("details" to schema_fb0686e874c29254, "pr" to schema_ea7fc856bb9aa12e), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a44865d83be28e9f: RemoteSchema by lazy {
    RemoteSchema(unionKind = "anyOf", options = listOf(schema_36fea325bf1aca70, schema_80c415b6e27c6ebd), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a467b0ed1c0ea208: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("kind", "minute"), properties = mapOf("kind" to schema_6f5933af0336650b, "minute" to schema_53f3c1938556e280), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a47dce098080dff5: RemoteSchema by lazy {
    RemoteSchema(unionKind = "oneOf", options = listOf(schema_ced55d8893218e84, schema_ac3c47c48ccf5bc6, schema_37c5f2164832811e, schema_174bab0c7c772746, schema_134ccbcdbce97927, schema_56d4279bb763b196, schema_c215a52302a1f428), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a563addb78b46707: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("changedFiles", "repoIdentities"), properties = mapOf("branch" to schema_36fea325bf1aca70, "changedFiles" to schema_56aa0e45cbdce0d0, "head" to schema_4e3a1013cf1d3a58, "repoIdentities" to schema_4db742376cbe66fa), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a581e67cd137ad59: RemoteSchema by lazy {
    RemoteSchema(type = "number", minimum = 0.0, maximum = 100.0, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a59d7f7afd3350b1: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("id", "label"), properties = mapOf("description" to schema_36fea325bf1aca70, "id" to schema_36fea325bf1aca70, "label" to schema_36fea325bf1aca70, "tooltipDescription" to schema_36fea325bf1aca70), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a5af9fa380f11a11: RemoteSchema by lazy {
    RemoteSchema(type = "string", maxLength = 2048, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a5b7c88e398574a5: RemoteSchema by lazy {
    RemoteSchema(type = "string", literals = listOf(JsonPrimitive("agent")), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a627cf0d1237385c: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("access", "path", "projectLocation"), properties = mapOf("access" to schema_2d29c7255e1cf1b1, "disposition" to schema_7db74ec55cf0af32, "path" to schema_bd85a52dd25effae, "projectLocation" to schema_080f9cc154af9e27), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a633f9a256d1d0c9: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("reason", "seq", "type"), properties = mapOf("reason" to schema_36fea325bf1aca70, "seq" to schema_56aa0e45cbdce0d0, "space" to schema_22c1b4b934fdb197, "type" to schema_d9640543f6c97ed9), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a66324f9a46c480b: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("headers", "type", "url"), properties = mapOf("headers" to schema_c3ac2139868061bb, "type" to schema_3120d80990432c9a, "url" to schema_7ac95086b2ca282e), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP, semanticIds = listOf("mcp.valid-url"))
}

internal val schema_a663eabb01251186: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("executionHost", "kind", "retryAt"), properties = mapOf("executionHost" to schema_bf0b727f7b1c6d07, "kind" to schema_daefe10db0766411, "retryAt" to schema_bf0b727f7b1c6d07), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a6940e107dbdb450: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("fwt"), properties = mapOf("fwt" to schema_bf0b727f7b1c6d07), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a6ba34cd39bf30c5: RemoteSchema by lazy {
    RemoteSchema(type = "boolean", defaultValue = JsonPrimitive(true), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a6c274420d82c814: RemoteSchema by lazy {
    RemoteSchema(type = "array", maxItems = 2, items = schema_97a2308a409b73af, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a6f98c7f485db267: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("projectLocation", "worktreePaths"), properties = mapOf("detail" to schema_15cae388d0cdd5b6, "projectLocation" to schema_080f9cc154af9e27, "worktreePaths" to schema_515482d2104d1efa), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a76106fec07f8e2b: RemoteSchema by lazy {
    RemoteSchema(type = "string", literals = listOf(JsonPrimitive("read"), JsonPrimitive("appearance"), JsonPrimitive("textSize"), JsonPrimitive("orientation"), JsonPrimitive("reduceMotion"), JsonPrimitive("network"), JsonPrimitive("location"), JsonPrimitive("permission"), JsonPrimitive("openUrl"), JsonPrimitive("launchApp"), JsonPrimitive("powerOff")), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a77c8545896b4c52: RemoteSchema by lazy {
    RemoteSchema(type = "string", literals = listOf(JsonPrimitive("move")), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a799b0e11ed8f6df: RemoteSchema by lazy {
    RemoteSchema(type = "string", literals = listOf(JsonPrimitive("usage.spent")), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_a7a81bdaababd798: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("ok"), properties = mapOf("created" to schema_feeb8bb50144d96d, "ok" to schema_d2dd3595e1b5e5dc, "project" to schema_295340fa71894405), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}
