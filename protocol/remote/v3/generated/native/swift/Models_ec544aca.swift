// GENERATED FILE. Do not edit by hand.
import Foundation
public struct RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D6_fefd665748: Codable, Sendable, RemoteModelMetadata {
  public var agent: RemoteField<RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D6U2DAgent_617a979a77> = .missing
  public var byteLength: Int64
  public var kind: RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D6U2DKind_1fcbd5bc41
  public var projectId: String
  public var sha256: String
  public var threadId: String
  public var transferId: String
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "agent", typeName: "RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D6U2DAgent_617a979a77", required: false, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "byteLength", typeName: "Int64", required: true, nullable: false, minimum: 1, maximum: 536870912, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "kind", typeName: "RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D6U2DKind_1fcbd5bc41", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "projectId", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "sha256", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: "^[0-9a-f]{64}$", format: nil, semanticValidatorIds: []),
    .init(wireName: "threadId", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "transferId", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: "^[A-Za-z0-9][A-Za-z0-9-]{7,63}$", format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case agent = "agent"
    case byteLength = "byteLength"
    case kind = "kind"
    case projectId = "projectId"
    case sha256 = "sha256"
    case threadId = "threadId"
    case transferId = "transferId"
  }
}

public enum RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D7U2DKind_69711423c3: String, Codable, Sendable {
  case `abort` = "abort"
}

public struct RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D7_cb09d6f7d6: Codable, Sendable, RemoteModelMetadata {
  public var kind: RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D7U2DKind_69711423c3
  public var transferId: String
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "kind", typeName: "RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D7U2DKind_69711423c3", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "transferId", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: "^[A-Za-z0-9][A-Za-z0-9-]{7,63}$", format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case kind = "kind"
    case transferId = "transferId"
  }
}

public enum RoutethreadU2DTransferU2DCommandRequest_52b6618ba3: Codable, Sendable {
  case option1(RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D1_cd9a361e55)
  case option2(RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D2_e30d1bfa71)
  case option3(RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D3_0e5eb22770)
  case option4(RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D4_73d7644dc8)
  case option5(RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D5_4734a988c0)
  case option6(RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D6_fefd665748)
  case option7(RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D7_cb09d6f7d6)
  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    var matches: [(Int, RoutethreadU2DTransferU2DCommandRequest_52b6618ba3)] = []
    if RemoteUnionProbe.matchesProperty(decoder, property: "kind", literals: [.string("describe")]), let value = try? container.decode(RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D1_cd9a361e55.self) {
      matches.append((1, .option1(value)))
    }
    if RemoteUnionProbe.matchesProperty(decoder, property: "kind", literals: [.string("plan")]), let value = try? container.decode(RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D2_e30d1bfa71.self) {
      matches.append((2, .option2(value)))
    }
    if RemoteUnionProbe.matchesProperty(decoder, property: "kind", literals: [.string("export")]), let value = try? container.decode(RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D3_0e5eb22770.self) {
      matches.append((3, .option3(value)))
    }
    if RemoteUnionProbe.matchesProperty(decoder, property: "kind", literals: [.string("read")]), let value = try? container.decode(RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D4_73d7644dc8.self) {
      matches.append((4, .option4(value)))
    }
    if RemoteUnionProbe.matchesProperty(decoder, property: "kind", literals: [.string("release")]), let value = try? container.decode(RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D5_4734a988c0.self) {
      matches.append((5, .option5(value)))
    }
    if RemoteUnionProbe.matchesProperty(decoder, property: "kind", literals: [.string("commit")]), let value = try? container.decode(RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D6_fefd665748.self) {
      matches.append((6, .option6(value)))
    }
    if RemoteUnionProbe.matchesProperty(decoder, property: "kind", literals: [.string("abort")]), let value = try? container.decode(RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D7_cb09d6f7d6.self) {
      matches.append((7, .option7(value)))
    }
    guard matches.count == 1 else {
      let detail = matches.isEmpty ? "No union option matched RoutethreadU2DTransferU2DCommandRequest_52b6618ba3" : "Ambiguous union RoutethreadU2DTransferU2DCommandRequest_52b6618ba3 matched options " + matches.map { String($0.0) }.joined(separator: ", ")
      throw DecodingError.typeMismatch(RoutethreadU2DTransferU2DCommandRequest_52b6618ba3.self, .init(codingPath: decoder.codingPath, debugDescription: detail))
    }
    self = matches[0].1
  }
  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .option1(let value): try container.encode(value)
    case .option2(let value): try container.encode(value)
    case .option3(let value): try container.encode(value)
    case .option4(let value): try container.encode(value)
    case .option5(let value): try container.encode(value)
    case .option6(let value): try container.encode(value)
    case .option7(let value): try container.encode(value)
    }
  }
}

public enum RoutethreadU2DTransferU2DCommandResponseU2DOptionU2D1U2DSourceU2DBlocker_63ccc3fa64: String, Codable, Sendable {
  case `notU5FChat` = "not_chat"
  case `busy` = "busy"
  case `noU5FHistory` = "no_history"
  case `unsupportedU5FLocation` = "unsupported_location"
}

public struct RoutethreadU2DTransferU2DCommandResponseU2DOptionU2D1U2DSourceU2DGitU2DOptionU2D1_a563addb78: Codable, Sendable, RemoteModelMetadata {
  public var branch: RemoteField<String> = .missing
  public var changedFiles: Int64
  public var head: RemoteField<String> = .missing
  public var repoIdentities: [String]
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "branch", typeName: "String", required: false, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "changedFiles", typeName: "Int64", required: true, nullable: false, minimum: 0, maximum: 9007199254740991, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "head", typeName: "String", required: false, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: "^[0-9a-f]{40}(?:[0-9a-f]{24})?$", format: nil, semanticValidatorIds: []),
    .init(wireName: "repoIdentities", typeName: "[String]", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: 16, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case branch = "branch"
    case changedFiles = "changedFiles"
    case head = "head"
    case repoIdentities = "repoIdentities"
  }
}

public typealias RoutethreadU2DTransferU2DCommandResponseU2DOptionU2D1U2DSourceU2DGit_8c2e2b2a66 = RoutethreadU2DTransferU2DCommandResponseU2DOptionU2D1U2DSourceU2DGitU2DOptionU2D1_a563addb78?

public struct RoutethreadU2DTransferU2DCommandResponseU2DOptionU2D1U2DSource_1150a8738e: Codable, Sendable, RemoteModelMetadata {
  public var agentKind: String
  public var blocker: RemoteField<RoutethreadU2DTransferU2DCommandResponseU2DOptionU2D1U2DSourceU2DBlocker_63ccc3fa64> = .missing
  public var git: RemoteField<RoutethreadU2DTransferU2DCommandResponseU2DOptionU2D1U2DSourceU2DGitU2DOptionU2D1_a563addb78>
  public var presentationMode: ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DOwnerU2DPresentationMode_6508684ba6
  public var threadId: String
  public var title: String
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "agentKind", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "blocker", typeName: "RoutethreadU2DTransferU2DCommandResponseU2DOptionU2D1U2DSourceU2DBlocker_63ccc3fa64", required: false, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "git", typeName: "RoutethreadU2DTransferU2DCommandResponseU2DOptionU2D1U2DSourceU2DGitU2DOptionU2D1_a563addb78", required: true, nullable: true, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "presentationMode", typeName: "ProcedureconnectThreadVoiceRequestU2DConfigU2DSelectionBindingU2DOwnerU2DPresentationMode_6508684ba6", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "threadId", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "title", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case agentKind = "agentKind"
    case blocker = "blocker"
    case git = "git"
    case presentationMode = "presentationMode"
    case threadId = "threadId"
    case title = "title"
  }
}

public struct RoutethreadU2DTransferU2DCommandResponseU2DOptionU2D1_ced55d8893: Codable, Sendable, RemoteModelMetadata {
  public var kind: RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D1U2DKind_7a2cd8ece4
  public var source: RoutethreadU2DTransferU2DCommandResponseU2DOptionU2D1U2DSource_1150a8738e
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "kind", typeName: "RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D1U2DKind_7a2cd8ece4", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "source", typeName: "RoutethreadU2DTransferU2DCommandResponseU2DOptionU2D1U2DSource_1150a8738e", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case kind = "kind"
    case source = "source"
  }
}

public struct RoutethreadU2DTransferU2DCommandResponseU2DOptionU2D2U2DProjectsU2DItem_b83973a63f: Codable, Sendable, RemoteModelMetadata {
  public var git: Bool
  public var matched: Bool
  public var name: ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b
  public var projectId: String
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "git", typeName: "Bool", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "matched", typeName: "Bool", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "name", typeName: "ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "projectId", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case git = "git"
    case matched = "matched"
    case name = "name"
    case projectId = "projectId"
  }
}

public struct RoutethreadU2DTransferU2DCommandResponseU2DOptionU2D2_ac3c47c48c: Codable, Sendable, RemoteModelMetadata {
  public var haves: [String]
  public var kind: RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D2U2DKind_75d835115f
  public var projects: [RoutethreadU2DTransferU2DCommandResponseU2DOptionU2D2U2DProjectsU2DItem_b83973a63f]
  public var selectedProjectId: RemoteField<String> = .missing
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "haves", typeName: "[String]", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: 256, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "kind", typeName: "RoutethreadU2DTransferU2DCommandRequestU2DOptionU2D2U2DKind_75d835115f", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "projects", typeName: "[RoutethreadU2DTransferU2DCommandResponseU2DOptionU2D2U2DProjectsU2DItem_b83973a63f]", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: 500, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "selectedProjectId", typeName: "String", required: false, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case haves = "haves"
    case kind = "kind"
    case projects = "projects"
    case selectedProjectId = "selectedProjectId"
  }
}
