// GENERATED FILE. Do not edit by hand.
import Foundation
public struct ProcedureconnectThreadVoiceRequestU2DConfigU2DPlaybookU2DOptionU2D1U2DOptionU2D1_cd0bda9376: Codable, Sendable, RemoteModelMetadata {
  public var exitPhrases: RemoteField<[String]> = .missing
  public var icon: RemoteField<String> = .missing
  public var id: String
  public var instructions: String
  public var label: String
  public var mcpServerIds: RemoteField<[String]> = .missing
  public var readOnly: RemoteField<ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1U2DOptionU2D1U2DRolesU2DItemU2DNoEdits_d2dd3595e1> = .missing
  public var switchPhrases: RemoteField<[String]> = .missing
  public var themeId: RemoteField<String> = .missing
  public var version: ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1U2DOptionU2D1U2DVersion_7f9f5a0d72
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .reject
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "exitPhrases", typeName: "[String]", required: false, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: 1, maxItems: 10, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "icon", typeName: "String", required: false, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: 48, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "id", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: "^[a-z0-9][a-z0-9-]{0,47}$", format: nil, semanticValidatorIds: []),
    .init(wireName: "instructions", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: 6000, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "label", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: 32, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "mcpServerIds", typeName: "[String]", required: false, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: 16, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "readOnly", typeName: "ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1U2DOptionU2D1U2DRolesU2DItemU2DNoEdits_d2dd3595e1", required: false, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "switchPhrases", typeName: "[String]", required: false, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: 1, maxItems: 10, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "themeId", typeName: "String", required: false, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: "^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$", format: nil, semanticValidatorIds: []),
    .init(wireName: "version", typeName: "ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1U2DOptionU2D1U2DVersion_7f9f5a0d72", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case exitPhrases = "exitPhrases"
    case icon = "icon"
    case id = "id"
    case instructions = "instructions"
    case label = "label"
    case mcpServerIds = "mcpServerIds"
    case readOnly = "readOnly"
    case switchPhrases = "switchPhrases"
    case themeId = "themeId"
    case version = "version"
  }
  public init(from decoder: Decoder) throws {
    let all = try decoder.container(keyedBy: RemoteCodingKey.self).allKeys.map(\.stringValue)
    let known = Set(Self.fields.map(\.wireName))
    guard all.allSatisfy(known.contains) else { throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown field in strict object")) }
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.exitPhrases = try container.decode(RemoteField<[String]>.self, forKey: .exitPhrases)
    self.icon = try container.decode(RemoteField<String>.self, forKey: .icon)
    self.id = try container.decode(String.self, forKey: .id)
    self.instructions = try container.decode(String.self, forKey: .instructions)
    self.label = try container.decode(String.self, forKey: .label)
    self.mcpServerIds = try container.decode(RemoteField<[String]>.self, forKey: .mcpServerIds)
    self.readOnly = try container.decode(RemoteField<ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1U2DOptionU2D1U2DRolesU2DItemU2DNoEdits_d2dd3595e1>.self, forKey: .readOnly)
    self.switchPhrases = try container.decode(RemoteField<[String]>.self, forKey: .switchPhrases)
    self.themeId = try container.decode(RemoteField<String>.self, forKey: .themeId)
    self.version = try container.decode(ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1U2DOptionU2D1U2DVersion_7f9f5a0d72.self, forKey: .version)
  }
  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(exitPhrases, forKey: .exitPhrases)
    try container.encode(icon, forKey: .icon)
    try container.encode(id, forKey: .id)
    try container.encode(instructions, forKey: .instructions)
    try container.encode(label, forKey: .label)
    try container.encode(mcpServerIds, forKey: .mcpServerIds)
    try container.encode(readOnly, forKey: .readOnly)
    try container.encode(switchPhrases, forKey: .switchPhrases)
    try container.encode(themeId, forKey: .themeId)
    try container.encode(version, forKey: .version)
  }
}

public enum ProcedureconnectThreadVoiceRequestU2DConfigU2DPlaybookU2DOptionU2D1_eeba513ecb: Codable, Sendable {
  case option1(ProcedureconnectThreadVoiceRequestU2DConfigU2DPlaybookU2DOptionU2D1U2DOptionU2D1_cd0bda9376)
  case option2(ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1U2DOptionU2D2_7053ed3816)
  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    var matches: [(Int, ProcedureconnectThreadVoiceRequestU2DConfigU2DPlaybookU2DOptionU2D1_eeba513ecb)] = []
    if RemoteUnionProbe.matchesObject(decoder), let value = try? container.decode(ProcedureconnectThreadVoiceRequestU2DConfigU2DPlaybookU2DOptionU2D1U2DOptionU2D1_cd0bda9376.self) {
      self = .option1(value); return
    }
    if RemoteUnionProbe.matchesObject(decoder), let value = try? container.decode(ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1U2DOptionU2D2_7053ed3816.self) {
      self = .option2(value); return
    }
    throw DecodingError.typeMismatch(ProcedureconnectThreadVoiceRequestU2DConfigU2DPlaybookU2DOptionU2D1_eeba513ecb.self, .init(codingPath: decoder.codingPath, debugDescription: "No union option matched ProcedureconnectThreadVoiceRequestU2DConfigU2DPlaybookU2DOptionU2D1_eeba513ecb"))
  }
  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .option1(let value): try container.encode(value)
    case .option2(let value): try container.encode(value)
    }
  }
}

public typealias ProcedureconnectThreadVoiceRequestU2DConfigU2DPlaybook_507b5fb1e0 = ProcedureconnectThreadVoiceRequestU2DConfigU2DPlaybookU2DOptionU2D1_eeba513ecb?

public struct ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValuesU2DOptionU2D1_adaa80878b: Codable, Sendable, RemoteModelMetadata {
  public var contextSize: RemoteField<ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b> = .missing
  public var effort: ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b
  public var fast: RemoteField<Bool> = .missing
  public var thinking: RemoteField<Bool> = .missing
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .reject
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "contextSize", typeName: "ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b", required: false, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "effort", typeName: "ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "fast", typeName: "Bool", required: false, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "thinking", typeName: "Bool", required: false, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case contextSize = "contextSize"
    case effort = "effort"
    case fast = "fast"
    case thinking = "thinking"
  }
  public init(from decoder: Decoder) throws {
    let all = try decoder.container(keyedBy: RemoteCodingKey.self).allKeys.map(\.stringValue)
    let known = Set(Self.fields.map(\.wireName))
    guard all.allSatisfy(known.contains) else { throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown field in strict object")) }
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.contextSize = try container.decode(RemoteField<ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b>.self, forKey: .contextSize)
    self.effort = try container.decode(ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b.self, forKey: .effort)
    self.fast = try container.decode(RemoteField<Bool>.self, forKey: .fast)
    self.thinking = try container.decode(RemoteField<Bool>.self, forKey: .thinking)
  }
  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(contextSize, forKey: .contextSize)
    try container.encode(effort, forKey: .effort)
    try container.encode(fast, forKey: .fast)
    try container.encode(thinking, forKey: .thinking)
  }
}

public struct ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DInertValuesU2DOptionU2D2_d1624ea0ec: Codable, Sendable, RemoteModelMetadata {
  public var contextSize: RemoteField<ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b> = .missing
  public var effort: RemoteField<ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b> = .missing
  public var fast: Bool
  public var thinking: RemoteField<Bool> = .missing
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .reject
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "contextSize", typeName: "ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b", required: false, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "effort", typeName: "ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b", required: false, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "fast", typeName: "Bool", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "thinking", typeName: "Bool", required: false, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case contextSize = "contextSize"
    case effort = "effort"
    case fast = "fast"
    case thinking = "thinking"
  }
  public init(from decoder: Decoder) throws {
    let all = try decoder.container(keyedBy: RemoteCodingKey.self).allKeys.map(\.stringValue)
    let known = Set(Self.fields.map(\.wireName))
    guard all.allSatisfy(known.contains) else { throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown field in strict object")) }
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.contextSize = try container.decode(RemoteField<ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b>.self, forKey: .contextSize)
    self.effort = try container.decode(RemoteField<ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b>.self, forKey: .effort)
    self.fast = try container.decode(Bool.self, forKey: .fast)
    self.thinking = try container.decode(RemoteField<Bool>.self, forKey: .thinking)
  }
  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(contextSize, forKey: .contextSize)
    try container.encode(effort, forKey: .effort)
    try container.encode(fast, forKey: .fast)
    try container.encode(thinking, forKey: .thinking)
  }
}
