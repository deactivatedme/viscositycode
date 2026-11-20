// GENERATED FILE. Do not edit by hand.
package com.poracode.remote.v3.generated

import kotlinx.serialization.*
import kotlinx.serialization.descriptors.*
import kotlinx.serialization.encoding.*
import kotlinx.serialization.json.*
@Serializable(with = ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValues_3dd69184dc.Serializer::class)
sealed interface ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValues_3dd69184dc {
    data class Option1(val value: ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValuesU2DOptionU2D1_adaa80878b) : ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValues_3dd69184dc
    data class Option2(val value: ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValuesU2DOptionU2D2_d1624ea0ec) : ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValues_3dd69184dc
    data class Option3(val value: ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValuesU2DOptionU2D3_2840caeaed) : ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValues_3dd69184dc
    data class Option4(val value: ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValuesU2DOptionU2D4_94dda13e1c) : ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValues_3dd69184dc
    object Serializer : KSerializer<ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValues_3dd69184dc> {
        override val descriptor: SerialDescriptor = buildClassSerialDescriptor("ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValues_3dd69184dc")
        override fun deserialize(decoder: Decoder): ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValues_3dd69184dc {
            val jsonDecoder = decoder as? JsonDecoder ?: throw SerializationException("ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValues_3dd69184dc supports JSON only")
            val element = jsonDecoder.decodeJsonElement()
            val matches = mutableListOf<RemoteUnionMatch<ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValues_3dd69184dc>>()
            RemoteUnionCodec.tryOption(matches, 1, element is JsonObject) { Option1(jsonDecoder.json.decodeFromJsonElement<ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValuesU2DOptionU2D1_adaa80878b>(element)) }
            RemoteUnionCodec.tryOption(matches, 2, element is JsonObject) { Option2(jsonDecoder.json.decodeFromJsonElement<ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValuesU2DOptionU2D2_d1624ea0ec>(element)) }
            RemoteUnionCodec.tryOption(matches, 3, element is JsonObject) { Option3(jsonDecoder.json.decodeFromJsonElement<ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValuesU2DOptionU2D3_2840caeaed>(element)) }
            RemoteUnionCodec.tryOption(matches, 4, element is JsonObject) { Option4(jsonDecoder.json.decodeFromJsonElement<ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValuesU2DOptionU2D4_94dda13e1c>(element)) }
            return RemoteUnionCodec.first("ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValues_3dd69184dc", matches)
        }
        override fun serialize(encoder: Encoder, value: ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValues_3dd69184dc) {
            val jsonEncoder = encoder as? JsonEncoder ?: throw SerializationException("ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValues_3dd69184dc supports JSON only")
            val element = when (value) {
                is Option1 -> jsonEncoder.json.encodeToJsonElement<ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValuesU2DOptionU2D1_adaa80878b>(value.value)
                is Option2 -> jsonEncoder.json.encodeToJsonElement<ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValuesU2DOptionU2D2_d1624ea0ec>(value.value)
                is Option3 -> jsonEncoder.json.encodeToJsonElement<ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValuesU2DOptionU2D3_2840caeaed>(value.value)
                is Option4 -> jsonEncoder.json.encodeToJsonElement<ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValuesU2DOptionU2D4_94dda13e1c>(value.value)
            }
            jsonEncoder.encodeJsonElement(element)
        }
    }
}

@Serializable
enum class ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DKind_452e07a326 {
    @SerialName("family-member") FAMILYU2DMEMBER,
}

@Serializable
enum class ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DOwnerU2DPresentationMode_6508684ba6 {
    @SerialName("terminal") TERMINAL,
    @SerialName("gui") GUI,
}

@Serializable
data class ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DOwner_a8eb5a0e02(
    @SerialName("agentInstanceId") val agentInstanceId: RemoteField<String> = RemoteField.Missing,
    @SerialName("agentKind") val agentKind: String,
    @SerialName("presentationMode") val presentationMode: ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DOwnerU2DPresentationMode_6508684ba6,
) {
    companion object {
        val descriptor = RemoteModelDescriptor(RemoteUnknownFieldPolicy.REJECT, listOf(
            RemoteFieldDescriptor("agentInstanceId", "String", false, false, null, null, 1, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("agentKind", "String", true, false, null, null, 1, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("presentationMode", "ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DOwnerU2DPresentationMode_6508684ba6", true, false, null, null, null, null, null, null, null, null, listOf()),
        ), listOf())
    }
}

@Serializable
data class ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBinding_a11ab76af3(
    @SerialName("inertValues") val inertValues: ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValues_3dd69184dc,
    @SerialName("kind") val kind: ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DKind_452e07a326,
    @SerialName("model") val model: String,
    @SerialName("owner") val owner: ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DOwner_a8eb5a0e02,
    @SerialName("version") val version: ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1U2DOptionU2D1U2DVersion_7f9f5a0d72,
) {
    companion object {
        val descriptor = RemoteModelDescriptor(RemoteUnknownFieldPolicy.REJECT, listOf(
            RemoteFieldDescriptor("inertValues", "ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValues_3dd69184dc", true, false, null, null, null, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("kind", "ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DKind_452e07a326", true, false, null, null, null, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("model", "String", true, false, null, null, 1, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("owner", "ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DOwner_a8eb5a0e02", true, false, null, null, null, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("version", "ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1U2DOptionU2D1U2DVersion_7f9f5a0d72", true, false, null, null, null, null, null, null, null, null, listOf()),
        ), listOf())
    }
}

@Serializable
data class ProcedureconnectThreadVoiceRequestU2DConfig_3630df9ed3(
    @SerialName("approvalPolicy") val approvalPolicy: RemoteField<ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b> = RemoteField.Missing,
    @SerialName("approvalsReviewer") val approvalsReviewer: RemoteField<ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b> = RemoteField.Missing,
    @SerialName("browserMcp") val browserMcp: RemoteField<Boolean> = RemoteField.Missing,
    @SerialName("chromeMcp") val chromeMcp: RemoteField<Boolean> = RemoteField.Missing,
    @SerialName("computerUse") val computerUse: RemoteField<Boolean> = RemoteField.Missing,
    @SerialName("contextSize") val contextSize: RemoteField<ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b> = RemoteField.Missing,
    @SerialName("crew") val crew: RemoteField<ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1_1e3c3dda8e> = RemoteField.Missing,
    @SerialName("crossagentMcp") val crossagentMcp: RemoteField<Boolean> = RemoteField.Missing,
    @SerialName("effort") val effort: RemoteField<ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b> = RemoteField.Missing,
    @SerialName("executionEnvironment") val executionEnvironment: RemoteField<ProcedureconnectThreadVoiceRequestU2DConfigU2DExecutionEnvironment_4cd2587996> = RemoteField.Missing,
    @SerialName("fast") val fast: RemoteField<Boolean> = RemoteField.Missing,
    @SerialName("importedFrom") val importedFrom: RemoteField<ProcedureconnectThreadVoiceRequestU2DConfigU2DImportedFrom_3471186f13> = RemoteField.Missing,
    @SerialName("mcpServerOverrides") val mcpServerOverrides: RemoteField<ProcedureconnectThreadVoiceRequestU2DConfigU2DMcpServerOverrides_6db96506f2> = RemoteField.Missing,
    @SerialName("mode") val mode: RemoteField<ProcedureconnectThreadVoiceRequestU2DConfigU2DMode_01e21946e9> = RemoteField.Missing,
    @SerialName("model") val model: String,
    @SerialName("playbook") val playbook: RemoteField<ProcedureconnectThreadVoiceRequestU2DConfigU2DPlaybookU2DOptionU2D1_eeba513ecb> = RemoteField.Missing,
    @SerialName("pluginOverrides") val pluginOverrides: RemoteField<ProcedureconnectThreadVoiceRequestU2DConfigU2DMcpServerOverrides_6db96506f2> = RemoteField.Missing,
    @SerialName("sandboxMode") val sandboxMode: RemoteField<ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b> = RemoteField.Missing,
    @SerialName("selectionBinding") val selectionBinding: RemoteField<ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBinding_a11ab76af3> = RemoteField.Missing,
    @SerialName("thinking") val thinking: RemoteField<Boolean> = RemoteField.Missing,
    @SerialName("workflows") val workflows: RemoteField<Boolean> = RemoteField.Missing,
) {
    companion object {
        val descriptor = RemoteModelDescriptor(RemoteUnknownFieldPolicy.STRIP, listOf(
            RemoteFieldDescriptor("approvalPolicy", "ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b", false, false, null, null, null, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("approvalsReviewer", "ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b", false, false, null, null, null, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("browserMcp", "Boolean", false, false, null, null, null, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("chromeMcp", "Boolean", false, false, null, null, null, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("computerUse", "Boolean", false, false, null, null, null, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("contextSize", "ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b", false, false, null, null, null, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("crew", "ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1_1e3c3dda8e", false, true, null, null, null, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("crossagentMcp", "Boolean", false, false, null, null, null, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("effort", "ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b", false, false, null, null, null, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("executionEnvironment", "ProcedureconnectThreadVoiceRequestU2DConfigU2DExecutionEnvironment_4cd2587996", false, false, null, null, null, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("fast", "Boolean", false, false, null, null, null, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("importedFrom", "ProcedureconnectThreadVoiceRequestU2DConfigU2DImportedFrom_3471186f13", false, false, null, null, null, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("mcpServerOverrides", "ProcedureconnectThreadVoiceRequestU2DConfigU2DMcpServerOverrides_6db96506f2", false, false, null, null, null, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("mode", "ProcedureconnectThreadVoiceRequestU2DConfigU2DMode_01e21946e9", false, false, null, null, null, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("model", "String", true, false, null, null, 1, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("playbook", "ProcedureconnectThreadVoiceRequestU2DConfigU2DPlaybookU2DOptionU2D1_eeba513ecb", false, true, null, null, null, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("pluginOverrides", "ProcedureconnectThreadVoiceRequestU2DConfigU2DMcpServerOverrides_6db96506f2", false, false, null, null, null, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("sandboxMode", "ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b", false, false, null, null, null, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("selectionBinding", "ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBinding_a11ab76af3", false, false, null, null, null, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("thinking", "Boolean", false, false, null, null, null, null, null, null, null, null, listOf()),
            RemoteFieldDescriptor("workflows", "Boolean", false, false, null, null, null, null, null, null, null, null, listOf()),
        ), listOf())
    }
}
