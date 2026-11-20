// GENERATED FILE. Do not edit by hand.
package com.poracode.remote.v3.generated

import kotlinx.serialization.*
import kotlinx.serialization.descriptors.*
import kotlinx.serialization.encoding.*
import kotlinx.serialization.json.*
internal val schema_6f5cce5ce127f97f: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("observedFingerprint", "state"), properties = mapOf("observedFingerprint" to schema_d3359b6d5db5b90d, "state" to schema_f6c555fb5f1777c9), additionalAllowed = false, unknownPolicy = RemoteUnknownFieldPolicy.REJECT)
}

internal val schema_6f5fd1f7837ee8fe: RemoteSchema by lazy {
    RemoteSchema(type = "string", literals = listOf(JsonPrimitive("read")), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_6fb5e1ff4ba2dc63: RemoteSchema by lazy {
    RemoteSchema(type = "integer", minimum = 1.0, maximum = 4.0, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_6fc62da359394b16: RemoteSchema by lazy {
    RemoteSchema(unionKind = "anyOf", options = listOf(schema_57bd680f6e04d0bc, schema_b7c373d0981a5441), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_6fcb1a55c059e655: RemoteSchema by lazy {
    RemoteSchema(type = "string", literals = listOf(JsonPrimitive("steer"), JsonPrimitive("queue")), defaultValue = JsonPrimitive("steer"), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_700ee4302bb616f0: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("environments"), properties = mapOf("environments" to schema_e4ed0fc98f59d7f1), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_701d7d6274e152f6: RemoteSchema by lazy {
    RemoteSchema(type = "string", literals = listOf(JsonPrimitive("reorder")), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_7053ed3816efd9d2: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("version"), properties = mapOf("version" to schema_bf4561eb7adf4d72), additionalSchema = schema_ca3d163bab055381, unknownPolicy = RemoteUnknownFieldPolicy.PASSTHROUGH)
}

internal val schema_70c198324af8bd9f: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("received"), properties = mapOf("received" to schema_56aa0e45cbdce0d0), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_70dc157e5476457b: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("accounts", "days", "models", "pricing", "providers", "totals"), properties = mapOf("accounts" to schema_2c09020b157316f2, "days" to schema_d37d1e49b0be87f8, "models" to schema_2c09020b157316f2, "pricing" to schema_7f0fc2dd36a6993f, "providers" to schema_2c09020b157316f2, "totals" to schema_05af39c3e918ff5a), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_70e5b904af7932c1: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("worktrees"), properties = mapOf("worktrees" to schema_cd357f47aa772b6a), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_711e84b2a6817609: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("reviewers", "truncated"), properties = mapOf("reviewers" to schema_1d261f6c634ca0b3, "truncated" to schema_feeb8bb50144d96d), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_71e40ca28c8b47ee: RemoteSchema by lazy {
    RemoteSchema(type = "array", items = schema_295340fa71894405, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_72130deafac7a5ba: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("done", "error", "needsAttention"), properties = mapOf("done" to schema_feeb8bb50144d96d, "error" to schema_feeb8bb50144d96d, "needsAttention" to schema_feeb8bb50144d96d), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_72373308389f2027: RemoteSchema by lazy {
    RemoteSchema(type = "string", literals = listOf(JsonPrimitive("merge"), JsonPrimitive("squash"), JsonPrimitive("rebase")), defaultValue = JsonPrimitive("merge"), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_72429c4be55ff8fc: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("projectLocation"), properties = mapOf("ghAccount" to schema_5646cf57ff3aebe0, "projectLocation" to schema_080f9cc154af9e27), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_725be166aa92607b: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("hostId", "projectId"), properties = mapOf("hostId" to schema_bf0b727f7b1c6d07, "projectId" to schema_bf0b727f7b1c6d07, "worktreePath" to schema_bf0b727f7b1c6d07), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_729d8ec2243ca0f3: RemoteSchema by lazy {
    RemoteSchema(unionKind = "oneOf", options = listOf(schema_cbf9eddea4280dec, schema_938eaedae89e4e2f), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_72a4409660da2b12: RemoteSchema by lazy {
    RemoteSchema(type = "string", literals = listOf(JsonPrimitive("details-v1")), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_72a4809a8d48dab8: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("type", "value"), properties = mapOf("type" to schema_c8c48a1118d06f0b, "value" to schema_f0f815c9ec0e3b5a), additionalAllowed = false, unknownPolicy = RemoteUnknownFieldPolicy.REJECT)
}

internal val schema_72caa7d86a390b15: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("agentSettings", "commitGenEffort", "commitGenFast", "commitGenModel", "commitGenProvider", "conflictResolverEffort", "conflictResolverFast", "conflictResolverModel", "conflictResolverPresentationMode", "conflictResolverProvider", "disabledAgents", "disabledBuiltInMcpServers", "enabledMcpServers", "followUpBehavior", "hiddenModels", "prAutomationDefault", "prMergeMethod", "providerOrder", "titleGenEffort", "titleGenFast", "titleGenModel", "titleGenProvider", "worktreeBasePath", "worktreeStorageMode", "wslCommitGenEffort", "wslCommitGenFast", "wslCommitGenModel", "wslCommitGenProvider", "wslConflictResolverEffort", "wslConflictResolverFast", "wslConflictResolverModel", "wslConflictResolverPresentationMode", "wslConflictResolverProvider", "wslTitleGenEffort", "wslTitleGenFast", "wslTitleGenModel", "wslTitleGenProvider", "wslWorktreeBasePath"), properties = mapOf("agentSettings" to schema_deb61378c1ff010b, "autoArchiveDoneAfterDays" to schema_56aa0e45cbdce0d0, "autoMarkDoneOnPrMerge" to schema_feeb8bb50144d96d, "commitGenEffort" to schema_bf0b727f7b1c6d07, "commitGenFast" to schema_feeb8bb50144d96d, "commitGenModel" to schema_bf0b727f7b1c6d07, "commitGenProvider" to schema_bf0b727f7b1c6d07, "commitGenSelection" to schema_32c3720f649f40a1, "conflictResolverEffort" to schema_bf0b727f7b1c6d07, "conflictResolverFast" to schema_feeb8bb50144d96d, "conflictResolverModel" to schema_bf0b727f7b1c6d07, "conflictResolverPresentationMode" to schema_6508684ba659826b, "conflictResolverProvider" to schema_bf0b727f7b1c6d07, "conflictResolverSelection" to schema_32c3720f649f40a1, "crews" to schema_91181085efd88304, "disabledAgents" to schema_0f732b9fceb2c6ac, "disabledBuiltInMcpServers" to schema_65899fb957cb9421, "enabledMcpServers" to schema_2d677fb04187d46b, "experimentJudgeSelection" to schema_32c3720f649f40a1, "followUpBehavior" to schema_6fcb1a55c059e655, "hiddenModels" to schema_86d5d72e84423420, "playbooks" to schema_f2ddb88c7fd324af, "prAutomationDefault" to schema_6df05d56a8273d4c, "prMergeMethod" to schema_9c01de6b080eca40, "providerOrder" to schema_0f732b9fceb2c6ac, "searchExclude" to schema_cda18ebe4af54c5c, "searchUseIgnoreFiles" to schema_feeb8bb50144d96d, "titleGenEffort" to schema_bf0b727f7b1c6d07, "titleGenFast" to schema_feeb8bb50144d96d, "titleGenModel" to schema_bf0b727f7b1c6d07, "titleGenProvider" to schema_bf0b727f7b1c6d07, "titleGenSelection" to schema_32c3720f649f40a1, "usage" to schema_18dc352c9a615faa, "worktreeBasePath" to schema_bf0b727f7b1c6d07, "worktreeStorageMode" to schema_953c573b196de65a, "wslCommitGenEffort" to schema_bf0b727f7b1c6d07, "wslCommitGenFast" to schema_feeb8bb50144d96d, "wslCommitGenModel" to schema_bf0b727f7b1c6d07, "wslCommitGenProvider" to schema_bf0b727f7b1c6d07, "wslCommitGenSelection" to schema_32c3720f649f40a1, "wslConflictResolverEffort" to schema_bf0b727f7b1c6d07, "wslConflictResolverFast" to schema_feeb8bb50144d96d, "wslConflictResolverModel" to schema_bf0b727f7b1c6d07, "wslConflictResolverPresentationMode" to schema_6508684ba659826b, "wslConflictResolverProvider" to schema_bf0b727f7b1c6d07, "wslConflictResolverSelection" to schema_32c3720f649f40a1, "wslTitleGenEffort" to schema_bf0b727f7b1c6d07, "wslTitleGenFast" to schema_feeb8bb50144d96d, "wslTitleGenModel" to schema_bf0b727f7b1c6d07, "wslTitleGenProvider" to schema_bf0b727f7b1c6d07, "wslTitleGenSelection" to schema_32c3720f649f40a1, "wslWorktreeBasePath" to schema_bf0b727f7b1c6d07), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_72ce7899de7d8b9d: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("enterPath"), properties = mapOf("enterPath" to schema_36fea325bf1aca70), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_7324613e41acced2: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("id", "label"), properties = mapOf("argumentHint" to schema_bf0b727f7b1c6d07, "description" to schema_bf0b727f7b1c6d07, "id" to schema_36fea325bf1aca70, "label" to schema_36fea325bf1aca70, "pluginId" to schema_36fea325bf1aca70, "pluginName" to schema_36fea325bf1aca70, "section" to schema_f4cab1817a71aa36, "skillInvocation" to schema_36fea325bf1aca70, "skillName" to schema_36fea325bf1aca70, "skillPath" to schema_36fea325bf1aca70, "skillProvider" to schema_36fea325bf1aca70, "skillScope" to schema_ac6ea0fc110d7efb), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_739ef5b32c1ac983: RemoteSchema by lazy {
    RemoteSchema(type = "array", items = schema_cac7783fa7c0ea01, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_73d7644dc835b94d: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("kind", "length", "offset", "transferId"), properties = mapOf("kind" to schema_6f5fd1f7837ee8fe, "length" to schema_5ea91ac05355eb18, "offset" to schema_56aa0e45cbdce0d0, "transferId" to schema_7f836db787c9df87), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_740c7dc82a88634a: RemoteSchema by lazy {
    RemoteSchema(type = "string", literals = listOf(JsonPrimitive("terminal-watch-baseline-ack")), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_744f57e3eb025261: RemoteSchema by lazy {
    RemoteSchema(type = "array", items = schema_26f96950d20651b3, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_745963f66484f8a1: RemoteSchema by lazy {
    RemoteSchema(type = "object", additionalSchema = schema_c1d4a9f752e166b1, propertyNames = schema_bf0b727f7b1c6d07, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_745f2435a66ae299: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("cacheReadTokens", "cacheWriteTokens", "estimatedUsd", "inputTokens", "models", "observed", "outputTokens", "providers", "tokens"), properties = mapOf("cacheReadTokens" to schema_56aa0e45cbdce0d0, "cacheWriteTokens" to schema_56aa0e45cbdce0d0, "estimatedUsd" to schema_f696f11685898ba7, "inputTokens" to schema_56aa0e45cbdce0d0, "models" to schema_195974ed118a4217, "observed" to schema_c8ef822f0af9edc7, "outputTokens" to schema_56aa0e45cbdce0d0, "providers" to schema_d0fa817300598095, "tokens" to schema_56aa0e45cbdce0d0), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_74659b54c1ae64b8: RemoteSchema by lazy {
    RemoteSchema(unionKind = "anyOf", options = listOf(schema_f9da03570b6c69fa, schema_b7c373d0981a5441), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_74839ee2e9eafd92: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("type"), properties = mapOf("type" to schema_b796dbfba5908fbc), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_74b3a4e21747a253: RemoteSchema by lazy {
    RemoteSchema(unionKind = "anyOf", options = listOf(schema_d3abf2cfac530357, schema_b7c373d0981a5441), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_757b67af108cc67a: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("path"), properties = mapOf("path" to schema_bd85a52dd25effae), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_7583b8d37fafbf18: RemoteSchema by lazy {
    RemoteSchema(type = "string", literals = listOf(JsonPrimitive("win32"), JsonPrimitive("darwin"), JsonPrimitive("linux")), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_75aa7b06238db739: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("kind", "x", "y"), properties = mapOf("kind" to schema_ef917452dcccd356, "x" to schema_80c415b6e27c6ebd, "y" to schema_80c415b6e27c6ebd), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_75adf15ca2f6d249: RemoteSchema by lazy {
    RemoteSchema(type = "string", maxLength = 16384, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_75b702ed8c9f54ac: RemoteSchema by lazy {
    RemoteSchema(type = "array", items = schema_294ca0c3f20bda2e, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_75bcf0cf295f1752: RemoteSchema by lazy {
    RemoteSchema(type = "string", minLength = 1, maxLength = 120, unknownPolicy = RemoteUnknownFieldPolicy.STRIP, semanticIds = listOf("schedule.cron", "string.trim"), transformIds = listOf("string.trim"))
}

internal val schema_75d835115fd0d1f9: RemoteSchema by lazy {
    RemoteSchema(type = "string", literals = listOf(JsonPrimitive("plan")), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_75fa28583d2c03c2: RemoteSchema by lazy {
    RemoteSchema(type = "string", literals = listOf(JsonPrimitive("findings"), JsonPrimitive("no-findings"), JsonPrimitive("changed-files"), JsonPrimitive("needs-attention"), JsonPrimitive("unknown")), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_7611350a61fc2c31: RemoteSchema by lazy {
    RemoteSchema(type = "string", literals = listOf(JsonPrimitive("updateModelContext")), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_764a6ce807515b78: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("agentKind", "archived", "attention", "canResumeWithConfig", "config", "createdAt", "done", "id", "projectId", "starred", "status", "title", "updatedAt"), properties = mapOf("activeTurnStartedAt" to schema_36fea325bf1aca70, "additionalDirectories" to schema_98d52bd55e800515, "agentInstanceId" to schema_fa4a387c10f5125f, "agentKind" to schema_36fea325bf1aca70, "archived" to schema_f8b6dd8128e8bfe0, "archivedAt" to schema_36fea325bf1aca70, "attention" to schema_58edfaf9f73b8db4, "canResumeWithConfig" to schema_f8b6dd8128e8bfe0, "config" to schema_3630df9ed3225440, "createdAt" to schema_36fea325bf1aca70, "done" to schema_f8b6dd8128e8bfe0, "doneAt" to schema_36fea325bf1aca70, "errorMessage" to schema_bf0b727f7b1c6d07, "forkedFrom" to schema_f48ab668e0f88dac, "groupId" to schema_bf0b727f7b1c6d07, "groupName" to schema_bf0b727f7b1c6d07, "id" to schema_36fea325bf1aca70, "interruptedTurn" to schema_2127b6212a816df5, "lastTurnEndedAt" to schema_36fea325bf1aca70, "lastTurnStartedAt" to schema_36fea325bf1aca70, "parentThreadId" to schema_36fea325bf1aca70, "prNumber" to schema_80c415b6e27c6ebd, "presentationMode" to schema_6508684ba659826b, "projectId" to schema_36fea325bf1aca70, "remoteId" to schema_36fea325bf1aca70, "remoteServerId" to schema_36fea325bf1aca70, "sessionConfigOptions" to schema_9b050dd4848ae8c2, "sessionRef" to schema_25df6feb29c4a959, "slashCommands" to schema_174f77d24d01fc57, "starred" to schema_f8b6dd8128e8bfe0, "status" to schema_8c61ed237d0ab3d0, "threadStatusSource" to schema_8f739487924008df, "title" to schema_36fea325bf1aca70, "updatedAt" to schema_36fea325bf1aca70, "workspaceGrantRevision" to schema_56aa0e45cbdce0d0, "workspaceId" to schema_36fea325bf1aca70, "worktreeBranch" to schema_bf0b727f7b1c6d07, "worktreePath" to schema_bf0b727f7b1c6d07), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_7675a7cd6ae22dbd: RemoteSchema by lazy {
    RemoteSchema(type = "object", additionalSchema = schema_d68bbd085678f807, propertyNames = schema_bf0b727f7b1c6d07, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_76767b687c50a873: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("adapterKind", "id", "installKind", "installedAt", "name", "version"), properties = mapOf("adapterKind" to schema_36fea325bf1aca70, "icon" to schema_bf0b727f7b1c6d07, "id" to schema_36fea325bf1aca70, "installKind" to schema_e5d4267d1db7cbbf, "installations" to schema_9e2c34c2585a7941, "installedAt" to schema_36fea325bf1aca70, "name" to schema_36fea325bf1aca70, "version" to schema_36fea325bf1aca70), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_769c50c6909920b7: RemoteSchema by lazy {
    RemoteSchema(type = "string", maxLength = 50000, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_76b2c94b29aad9b1: RemoteSchema by lazy {
    RemoteSchema(unionKind = "oneOf", options = listOf(schema_06735b175e7447d5, schema_f97770a7e3ba8e29), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_76ba6b1ee1436f68: RemoteSchema by lazy {
    RemoteSchema(type = "string", minLength = 1, maxLength = 200, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_76cd651d417b864e: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("config", "prompt"), properties = mapOf("clientContext" to schema_b23ca9582f16c4d7, "config" to schema_3630df9ed3225440, "prompt" to schema_bf0b727f7b1c6d07, "segments" to schema_4392338ffc80bed7), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_770f1d9c539094c0: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("agentKind"), properties = mapOf("agentKind" to schema_36fea325bf1aca70, "wslDistros" to schema_0f732b9fceb2c6ac), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_7738b69937d794b0: RemoteSchema by lazy {
    RemoteSchema(unionKind = "anyOf", options = listOf(schema_97d85a5eaee82b97, schema_b7c373d0981a5441), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_776626d20373881d: RemoteSchema by lazy {
    RemoteSchema(type = "string", literals = listOf(JsonPrimitive("today"), JsonPrimitive("7d"), JsonPrimitive("30d"), JsonPrimitive("cycle")), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_77a7dec7edfc464f: RemoteSchema by lazy {
    RemoteSchema(type = "string", literals = listOf(JsonPrimitive("exact"), JsonPrimitive("suspect")), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_77bd08fa0d0c9544: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("access", "agentAccess", "deviceId", "generation", "version"), properties = mapOf("access" to schema_9ca4aec6d46ade2e, "agentAccess" to schema_e6bc2fd97be6dec8, "deviceId" to schema_97d85a5eaee82b97, "generation" to schema_d855999aed5e6438, "version" to schema_7f9f5a0d72de0d9a), additionalAllowed = false, unknownPolicy = RemoteUnknownFieldPolicy.REJECT)
}

internal val schema_77c71c73158736b6: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("id", "kind"), properties = mapOf("id" to schema_d855999aed5e6438, "kind" to schema_482c9282715722ac), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_77f2cf560a042976: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("agentKind", "model"), properties = mapOf("agentKind" to schema_8e43cad70cd70de7, "contextSize" to schema_7d62681c6488867d, "effort" to schema_7d62681c6488867d, "fast" to schema_feeb8bb50144d96d, "model" to schema_97d85a5eaee82b97), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_787a4eb5b07ac829: RemoteSchema by lazy {
    RemoteSchema(type = "string", pattern = "^[a-z0-9][a-z0-9-]{0,47}$", unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_78830b3d6ec86f55: RemoteSchema by lazy {
    RemoteSchema(unionKind = "anyOf", options = listOf(schema_80c415b6e27c6ebd, schema_b7c373d0981a5441), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_78a16ea62277e780: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("projectLocation"), properties = mapOf("preserveLocalChanges" to schema_f8b6dd8128e8bfe0, "projectLocation" to schema_080f9cc154af9e27, "remote" to schema_bfc0c020a52f85b3), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_78c0e367e5120eb3: RemoteSchema by lazy {
    RemoteSchema(unionKind = "anyOf", options = listOf(schema_feeb8bb50144d96d, schema_b7c373d0981a5441), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_78ecc0eb2955fb7f: RemoteSchema by lazy {
    RemoteSchema(type = "array", items = schema_46c9cbbd3df64c2a, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_790bb75cc69482f3: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("kind", "snapshot"), properties = mapOf("kind" to schema_9e712b4f87e5beb0, "snapshot" to schema_0f9c173ab5cc3412), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_79608b5eceb792fe: RemoteSchema by lazy {
    RemoteSchema(type = "object", additionalSchema = schema_feeb8bb50144d96d, propertyNames = schema_13f43aaaf56911fa, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_7978d152fa09ea8e: RemoteSchema by lazy {
    RemoteSchema(type = "array", items = schema_8f483f0889171da1, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_7991f24cd86fea2b: RemoteSchema by lazy {
    RemoteSchema(unionKind = "oneOf", options = listOf(schema_790bb75cc69482f3, schema_ef87859627e44f2b), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_79cc8fd8772975d2: RemoteSchema by lazy {
    RemoteSchema(type = "string", literals = listOf(JsonPrimitive("status")), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_79fd49e14d0e7e17: RemoteSchema by lazy {
    RemoteSchema(type = "string", literals = listOf(JsonPrimitive("open"), JsonPrimitive("draft"), JsonPrimitive("merged"), JsonPrimitive("closed")), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_7a00457b3e3294c1: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("flowId", "kind", "scope"), properties = mapOf("flowId" to schema_36fea325bf1aca70, "kind" to schema_04569d9eea76ae2b, "scope" to schema_dc99757951407418), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_7a20e2f82d6f16d6: RemoteSchema by lazy {
    RemoteSchema(unionKind = "anyOf", options = listOf(schema_ee6af1c3c62ad32f, schema_b7c373d0981a5441), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_7a2cd8ece40e9e4d: RemoteSchema by lazy {
    RemoteSchema(type = "string", literals = listOf(JsonPrimitive("describe")), unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_7a39782ede66b352: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("transport"), properties = mapOf("transport" to schema_e37012a6e5cb600d), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_7a4831c3c01cfb91: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("canGoBack", "canGoForward", "loading", "tabId", "title", "url"), properties = mapOf("canGoBack" to schema_feeb8bb50144d96d, "canGoForward" to schema_feeb8bb50144d96d, "faviconUrl" to schema_bf0b727f7b1c6d07, "loading" to schema_feeb8bb50144d96d, "tabId" to schema_36fea325bf1aca70, "title" to schema_bf0b727f7b1c6d07, "url" to schema_bf0b727f7b1c6d07), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}

internal val schema_7ab420c1b78efb1d: RemoteSchema by lazy {
    RemoteSchema(type = "object", required = setOf("agentKind", "config", "enabled", "name", "prompt", "recurrence"), properties = mapOf("agentKind" to schema_36fea325bf1aca70, "automation" to schema_fdddba9ec6ce269e, "config" to schema_f69100925fc0e774, "enabled" to schema_feeb8bb50144d96d, "name" to schema_b89c357946c21293, "projectId" to schema_2d0b6ec9f2b2decf, "prompt" to schema_30cc89214bd9dffb, "recurrence" to schema_12f751ee47b47fbd), additionalAllowed = true, unknownPolicy = RemoteUnknownFieldPolicy.STRIP)
}
