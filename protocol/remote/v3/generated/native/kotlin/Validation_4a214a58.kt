// GENERATED FILE. Do not edit by hand.
package com.poracode.remote.v3.generated

import kotlinx.serialization.*
import kotlinx.serialization.descriptors.*
import kotlinx.serialization.encoding.*
import kotlinx.serialization.json.*
internal val schema_66d66ce0fd3d9001: RemoteSchema by lazy {
    RemoteSchema(type = "string", literals = listOf(JsonPrimitive("global")), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_66ee2eb4eda62117: RemoteSchema by lazy {
    RemoteSchema(unionKind = "anyOf", options = listOf(schema_ae4a7605815e4393, schema_b7c373d0981a5441), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_67373e16013c20e7: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("expectedRevision", "fingerprint"), properties = mapOf("expectedRevision" to schema_f58a8b771657d037, "fingerprint" to schema_d3359b6d5db5b90d), additionalAllowed = false, unknownPolicy = RemoteUnknownFieldPolicy.REJECT)
}

internal val schema_678d084ee287670a: RemoteSchema by lazy {
    RemoteSchema(type = "object", properties = mapOf("gui" to schema_2363c4dd0a78ce9d, "terminal" to schema_2363c4dd0a78ce9d), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_6801e053c0220116: RemoteSchema by lazy {
    RemoteSchema(type = "string", literals = listOf(JsonPrimitive("back")), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_682961f5d2dbd9ba: RemoteSchema by lazy {
    RemoteSchema(type = "string", maxLength = 5592408, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_684d2eec4cf8a72b: RemoteSchema by lazy {
    RemoteSchema(type = "string", minLength = 4, maxLength = 262144, pattern = "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$", unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_685dee710cb094fd: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("args", "binary"), properties = mapOf("args" to schema_0f732b9fceb2c6ac, "binary" to schema_36fea325bf1aca70), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_68b4b3341e5ced85: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("updatedAt", "windows", "wsl"), properties = mapOf("detecting" to schema_feeb8bb50144d96d, "updatedAt" to schema_36fea325bf1aca70, "windows" to schema_87cc7463d001a1f6, "wsl" to schema_87cc7463d001a1f6), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_68e20c886f83f254: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("agentSettings", "commitGenEffort", "commitGenFast", "commitGenModel", "commitGenProvider", "conflictResolverEffort", "conflictResolverFast", "conflictResolverModel", "conflictResolverPresentationMode", "conflictResolverProvider", "disabledAgents", "disabledBuiltInMcpServers", "enabledMcpServers", "followUpBehavior", "hiddenModels", "prAutomationDefault", "prMergeMethod", "providerOrder", "titleGenEffort", "titleGenFast", "titleGenModel", "titleGenProvider", "worktreeBasePath", "worktreeStorageMode", "wslCommitGenEffort", "wslCommitGenFast", "wslCommitGenModel", "wslCommitGenProvider", "wslConflictResolverEffort", "wslConflictResolverFast", "wslConflictResolverModel", "wslConflictResolverPresentationMode", "wslConflictResolverProvider", "wslTitleGenEffort", "wslTitleGenFast", "wslTitleGenModel", "wslTitleGenProvider", "wslWorktreeBasePath"), properties = mapOf("agentSettings" to schema_deb61378c1ff010b, "commitGenEffort" to schema_bf0b727f7b1c6d07, "commitGenFast" to schema_feeb8bb50144d96d, "commitGenModel" to schema_bf0b727f7b1c6d07, "commitGenProvider" to schema_bf0b727f7b1c6d07, "commitGenSelection" to schema_32c3720f649f40a1, "conflictResolverEffort" to schema_bf0b727f7b1c6d07, "conflictResolverFast" to schema_feeb8bb50144d96d, "conflictResolverModel" to schema_bf0b727f7b1c6d07, "conflictResolverPresentationMode" to schema_6508684ba659826b, "conflictResolverProvider" to schema_bf0b727f7b1c6d07, "conflictResolverSelection" to schema_32c3720f649f40a1, "crews" to schema_91181085efd88304, "disabledAgents" to schema_0f732b9fceb2c6ac, "disabledBuiltInMcpServers" to schema_65899fb957cb9421, "enabledMcpServers" to schema_2d677fb04187d46b, "experimentJudgeSelection" to schema_32c3720f649f40a1, "followUpBehavior" to schema_6fcb1a55c059e655, "hiddenModels" to schema_86d5d72e84423420, "playbooks" to schema_f2ddb88c7fd324af, "prAutomationDefault" to schema_6df05d56a8273d4c, "prMergeMethod" to schema_9c01de6b080eca40, "providerOrder" to schema_0f732b9fceb2c6ac, "searchExclude" to schema_cda18ebe4af54c5c, "searchUseIgnoreFiles" to schema_feeb8bb50144d96d, "titleGenEffort" to schema_bf0b727f7b1c6d07, "titleGenFast" to schema_feeb8bb50144d96d, "titleGenModel" to schema_bf0b727f7b1c6d07, "titleGenProvider" to schema_bf0b727f7b1c6d07, "titleGenSelection" to schema_32c3720f649f40a1, "usage" to schema_18dc352c9a615faa, "worktreeBasePath" to schema_bf0b727f7b1c6d07, "worktreeStorageMode" to schema_953c573b196de65a, "wslCommitGenEffort" to schema_bf0b727f7b1c6d07, "wslCommitGenFast" to schema_feeb8bb50144d96d, "wslCommitGenModel" to schema_bf0b727f7b1c6d07, "wslCommitGenProvider" to schema_bf0b727f7b1c6d07, "wslCommitGenSelection" to schema_32c3720f649f40a1, "wslConflictResolverEffort" to schema_bf0b727f7b1c6d07, "wslConflictResolverFast" to schema_feeb8bb50144d96d, "wslConflictResolverModel" to schema_bf0b727f7b1c6d07, "wslConflictResolverPresentationMode" to schema_6508684ba659826b, "wslConflictResolverProvider" to schema_bf0b727f7b1c6d07, "wslConflictResolverSelection" to schema_32c3720f649f40a1, "wslTitleGenEffort" to schema_bf0b727f7b1c6d07, "wslTitleGenFast" to schema_feeb8bb50144d96d, "wslTitleGenModel" to schema_bf0b727f7b1c6d07, "wslTitleGenProvider" to schema_bf0b727f7b1c6d07, "wslTitleGenSelection" to schema_32c3720f649f40a1, "wslWorktreeBasePath" to schema_bf0b727f7b1c6d07), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_6900ba2bd97d76fc: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("branch", "projectLocation"), properties = mapOf("branch" to schema_36fea325bf1aca70, "projectLocation" to schema_080f9cc154af9e27, "sourceBranchOverride" to schema_bf0b727f7b1c6d07), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_694e88722e472029: RemoteSchema by lazy {
    RemoteSchema(unionKind = "anyOf", options = listOf(schema_cd357f47aa772b6a, schema_b7c373d0981a5441), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_696917027581de46: RemoteSchema by lazy {
    RemoteSchema(type = "object", properties = mapOf("deviceType" to schema_28ab5341451545c8, "label" to schema_36fea325bf1aca70, "os" to schema_36fea325bf1aca70), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_69711423c3b7d2a6: RemoteSchema by lazy {
    RemoteSchema(type = "string", literals = listOf(JsonPrimitive("abort")), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_69af29ff385f1e03: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("kind", "workspaceId"), properties = mapOf("kind" to schema_96cd458fa9bae303, "workspaceId" to schema_df704162f3d15808), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_69f5ba498bd960ff: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("item"), properties = mapOf("item" to schema_4c1171296b6868a1), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_6a0abedb39fd6f31: RemoteSchema by lazy {
    RemoteSchema(type = "string", literals = listOf(JsonPrimitive("delete-worktree-group")), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}
