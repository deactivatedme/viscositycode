// GENERATED FILE. Do not edit by hand.
import Foundation
public typealias ProcedurebrowseHostDirectoryResultU2DParentPath_2d0b6ec9f2 = ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b?

public struct ProcedurebrowseHostDirectoryResult_94eb65eaca: Codable, Sendable, RemoteModelMetadata {
  public var entries: [ProcedurebrowseHostDirectoryResultU2DEntriesU2DItem_d0ecd43b5f]
  public var homePath: ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b
  public var parentPath: RemoteField<ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b>
  public var path: ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b
  public var truncated: Bool
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "entries", typeName: "[ProcedurebrowseHostDirectoryResultU2DEntriesU2DItem_d0ecd43b5f]", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "homePath", typeName: "ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "parentPath", typeName: "ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b", required: true, nullable: true, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "path", typeName: "ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "truncated", typeName: "Bool", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case entries = "entries"
    case homePath = "homePath"
    case parentPath = "parentPath"
    case path = "path"
    case truncated = "truncated"
  }
}

public struct ProcedurecancelExtractContextRequest_09b78d9c1d: Codable, Sendable, RemoteModelMetadata {
  public var threadId: String
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "threadId", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case threadId = "threadId"
  }
}

public struct ProcedureclearMcpServerOauthRequest_db8efd22aa: Codable, Sendable, RemoteModelMetadata {
  public var projectLocation: RemoteField<ProcedurebeginMcpServerOauthRequestU2DProjectLocation_080f9cc154> = .missing
  public var url: String
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "projectLocation", typeName: "ProcedurebeginMcpServerOauthRequestU2DProjectLocation_080f9cc154", required: false, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "url", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case projectLocation = "projectLocation"
    case url = "url"
  }
}

public enum ProcedurecloneRepoRequestU2DSourceU2DOptionU2D1U2DKind_3cd19b85f5: String, Codable, Sendable {
  case `url` = "url"
}

public struct ProcedurecloneRepoRequestU2DSourceU2DOptionU2D1_06735b175e: Codable, Sendable, RemoteModelMetadata {
  public var kind: ProcedurecloneRepoRequestU2DSourceU2DOptionU2D1U2DKind_3cd19b85f5
  public var url: String
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "kind", typeName: "ProcedurecloneRepoRequestU2DSourceU2DOptionU2D1U2DKind_3cd19b85f5", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "url", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case kind = "kind"
    case url = "url"
  }
}

public struct ProcedurecloneRepoRequestU2DSourceU2DOptionU2D2U2DAccount_5646cf57ff: Codable, Sendable, RemoteModelMetadata {
  public var host: String
  public var login: String
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "host", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "login", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case host = "host"
    case login = "login"
  }
}

public enum ProcedurecloneRepoRequestU2DSourceU2DOptionU2D2U2DKind_cc1f68c41f: String, Codable, Sendable {
  case `github` = "github"
}

public struct ProcedurecloneRepoRequestU2DSourceU2DOptionU2D2_f97770a7e3: Codable, Sendable, RemoteModelMetadata {
  public var account: ProcedurecloneRepoRequestU2DSourceU2DOptionU2D2U2DAccount_5646cf57ff
  public var kind: ProcedurecloneRepoRequestU2DSourceU2DOptionU2D2U2DKind_cc1f68c41f
  public var nameWithOwner: String
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "account", typeName: "ProcedurecloneRepoRequestU2DSourceU2DOptionU2D2U2DAccount_5646cf57ff", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "kind", typeName: "ProcedurecloneRepoRequestU2DSourceU2DOptionU2D2U2DKind_cc1f68c41f", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "nameWithOwner", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case account = "account"
    case kind = "kind"
    case nameWithOwner = "nameWithOwner"
  }
}

public enum ProcedurecloneRepoRequestU2DSource_76b2c94b29: Codable, Sendable {
  case option1(ProcedurecloneRepoRequestU2DSourceU2DOptionU2D1_06735b175e)
  case option2(ProcedurecloneRepoRequestU2DSourceU2DOptionU2D2_f97770a7e3)
  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    var matches: [(Int, ProcedurecloneRepoRequestU2DSource_76b2c94b29)] = []
    if RemoteUnionProbe.matchesProperty(decoder, property: "kind", literals: [.string("url")]), let value = try? container.decode(ProcedurecloneRepoRequestU2DSourceU2DOptionU2D1_06735b175e.self) {
      matches.append((1, .option1(value)))
    }
    if RemoteUnionProbe.matchesProperty(decoder, property: "kind", literals: [.string("github")]), let value = try? container.decode(ProcedurecloneRepoRequestU2DSourceU2DOptionU2D2_f97770a7e3.self) {
      matches.append((2, .option2(value)))
    }
    guard matches.count == 1 else {
      let detail = matches.isEmpty ? "No union option matched ProcedurecloneRepoRequestU2DSource_76b2c94b29" : "Ambiguous union ProcedurecloneRepoRequestU2DSource_76b2c94b29 matched options " + matches.map { String($0.0) }.joined(separator: ", ")
      throw DecodingError.typeMismatch(ProcedurecloneRepoRequestU2DSource_76b2c94b29.self, .init(codingPath: decoder.codingPath, debugDescription: detail))
    }
    self = matches[0].1
  }
  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .option1(let value): try container.encode(value)
    case .option2(let value): try container.encode(value)
    }
  }
}

public struct ProcedurecloneRepoRequest_482895ec91: Codable, Sendable, RemoteModelMetadata {
  public var name: String
  public var parentLocation: ProcedurebeginMcpServerOauthRequestU2DProjectLocation_080f9cc154
  public var source: ProcedurecloneRepoRequestU2DSource_76b2c94b29
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "name", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "parentLocation", typeName: "ProcedurebeginMcpServerOauthRequestU2DProjectLocation_080f9cc154", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "source", typeName: "ProcedurecloneRepoRequestU2DSource_76b2c94b29", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case name = "name"
    case parentLocation = "parentLocation"
    case source = "source"
  }
}

public struct ProcedurecloneRepoResult_6a0c18e639: Codable, Sendable, RemoteModelMetadata {
  public var path: String
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "path", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case path = "path"
  }
}

public struct ProcedurecloseCodeShareWorkspaceRequest_9c6e793c40: Codable, Sendable, RemoteModelMetadata {
  public var grantId: String
  public var incarnation: String
  public var projectLocation: ProcedurebeginMcpServerOauthRequestU2DProjectLocation_080f9cc154
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .reject
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "grantId", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$", format: "uuid", semanticValidatorIds: []),
    .init(wireName: "incarnation", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$", format: "uuid", semanticValidatorIds: []),
    .init(wireName: "projectLocation", typeName: "ProcedurebeginMcpServerOauthRequestU2DProjectLocation_080f9cc154", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case grantId = "grantId"
    case incarnation = "incarnation"
    case projectLocation = "projectLocation"
  }
  public init(from decoder: Decoder) throws {
    let all = try decoder.container(keyedBy: RemoteCodingKey.self).allKeys.map(\.stringValue)
    let known = Set(Self.fields.map(\.wireName))
    guard all.allSatisfy(known.contains) else { throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown field in strict object")) }
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.grantId = try container.decode(String.self, forKey: .grantId)
    self.incarnation = try container.decode(String.self, forKey: .incarnation)
    self.projectLocation = try container.decode(ProcedurebeginMcpServerOauthRequestU2DProjectLocation_080f9cc154.self, forKey: .projectLocation)
  }
  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(grantId, forKey: .grantId)
    try container.encode(incarnation, forKey: .incarnation)
    try container.encode(projectLocation, forKey: .projectLocation)
  }
}

public typealias ProcedurecloseCodeShareWorkspaceResultU2DClosed_d2dd3595e1 = Bool

public struct ProcedurecloseCodeShareWorkspaceResult_493210a9cb: Codable, Sendable, RemoteModelMetadata {
  public var closed: ProcedurecloseCodeShareWorkspaceResultU2DClosed_d2dd3595e1
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "closed", typeName: "ProcedurecloseCodeShareWorkspaceResultU2DClosed_d2dd3595e1", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case closed = "closed"
  }
}

public enum ProcedureconfigureCodeShareProjectsRequestU2DOptionU2D1U2DAction_81574afa42: String, Codable, Sendable {
  case `connect` = "connect"
}

public struct ProcedureconfigureCodeShareProjectsRequestU2DOptionU2D1_8b70bcf8c6: Codable, Sendable, RemoteModelMetadata {
  public var action: ProcedureconfigureCodeShareProjectsRequestU2DOptionU2D1U2DAction_81574afa42
  public var origin: String
  public var token: String
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .reject
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "action", typeName: "ProcedureconfigureCodeShareProjectsRequestU2DOptionU2D1U2DAction_81574afa42", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "origin", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: 512, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "token", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: "^[A-Za-z0-9_-]{43}$", format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case action = "action"
    case origin = "origin"
    case token = "token"
  }
  public init(from decoder: Decoder) throws {
    let all = try decoder.container(keyedBy: RemoteCodingKey.self).allKeys.map(\.stringValue)
    let known = Set(Self.fields.map(\.wireName))
    guard all.allSatisfy(known.contains) else { throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown field in strict object")) }
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.action = try container.decode(ProcedureconfigureCodeShareProjectsRequestU2DOptionU2D1U2DAction_81574afa42.self, forKey: .action)
    self.origin = try container.decode(String.self, forKey: .origin)
    self.token = try container.decode(String.self, forKey: .token)
  }
  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(action, forKey: .action)
    try container.encode(origin, forKey: .origin)
    try container.encode(token, forKey: .token)
  }
}

public enum ProcedureconfigureCodeShareProjectsRequestU2DOptionU2D2U2DAction_2750481e9a: String, Codable, Sendable {
  case `disconnect` = "disconnect"
}

public struct ProcedureconfigureCodeShareProjectsRequestU2DOptionU2D2_f6e97e56f9: Codable, Sendable, RemoteModelMetadata {
  public var action: ProcedureconfigureCodeShareProjectsRequestU2DOptionU2D2U2DAction_2750481e9a
  public var origin: String
  public var token: String
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .reject
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "action", typeName: "ProcedureconfigureCodeShareProjectsRequestU2DOptionU2D2U2DAction_2750481e9a", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "origin", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: 512, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "token", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: "^[A-Za-z0-9_-]{43}$", format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case action = "action"
    case origin = "origin"
    case token = "token"
  }
  public init(from decoder: Decoder) throws {
    let all = try decoder.container(keyedBy: RemoteCodingKey.self).allKeys.map(\.stringValue)
    let known = Set(Self.fields.map(\.wireName))
    guard all.allSatisfy(known.contains) else { throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown field in strict object")) }
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.action = try container.decode(ProcedureconfigureCodeShareProjectsRequestU2DOptionU2D2U2DAction_2750481e9a.self, forKey: .action)
    self.origin = try container.decode(String.self, forKey: .origin)
    self.token = try container.decode(String.self, forKey: .token)
  }
  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(action, forKey: .action)
    try container.encode(origin, forKey: .origin)
    try container.encode(token, forKey: .token)
  }
}

public enum ProcedureconfigureCodeShareProjectsRequest_deb13fe8b7: Codable, Sendable {
  case option1(ProcedureconfigureCodeShareProjectsRequestU2DOptionU2D1_8b70bcf8c6)
  case option2(ProcedureconfigureCodeShareProjectsRequestU2DOptionU2D2_f6e97e56f9)
  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    var matches: [(Int, ProcedureconfigureCodeShareProjectsRequest_deb13fe8b7)] = []
    if RemoteUnionProbe.matchesProperty(decoder, property: "action", literals: [.string("connect")]), let value = try? container.decode(ProcedureconfigureCodeShareProjectsRequestU2DOptionU2D1_8b70bcf8c6.self) {
      matches.append((1, .option1(value)))
    }
    if RemoteUnionProbe.matchesProperty(decoder, property: "action", literals: [.string("disconnect")]), let value = try? container.decode(ProcedureconfigureCodeShareProjectsRequestU2DOptionU2D2_f6e97e56f9.self) {
      matches.append((2, .option2(value)))
    }
    guard matches.count == 1 else {
      let detail = matches.isEmpty ? "No union option matched ProcedureconfigureCodeShareProjectsRequest_deb13fe8b7" : "Ambiguous union ProcedureconfigureCodeShareProjectsRequest_deb13fe8b7 matched options " + matches.map { String($0.0) }.joined(separator: ", ")
      throw DecodingError.typeMismatch(ProcedureconfigureCodeShareProjectsRequest_deb13fe8b7.self, .init(codingPath: decoder.codingPath, debugDescription: detail))
    }
    self = matches[0].1
  }
  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .option1(let value): try container.encode(value)
    case .option2(let value): try container.encode(value)
    }
  }
}

public struct ProcedureconfigureCodeShareProjectsResult_53062fbb54: Codable, Sendable, RemoteModelMetadata {
  public var connected: Bool
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "connected", typeName: "Bool", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case connected = "connected"
  }
}

public enum ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1U2DOptionU2D1U2DPolicy_5e585becfd: String, Codable, Sendable {
  case `crewU2DOnly` = "crew-only"
  case `crewU2DFirst` = "crew-first"
}

public struct ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1U2DOptionU2D1U2DRolesU2DItemU2DFallbacksU2DItem_c33d76cdf9: Codable, Sendable, RemoteModelMetadata {
  public var agentKind: String
  public var contextSize: RemoteField<String> = .missing
  public var effort: RemoteField<String> = .missing
  public var fast: RemoteField<Bool> = .missing
  public var model: String
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .reject
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "agentKind", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: 128, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "contextSize", typeName: "String", required: false, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: 64, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "effort", typeName: "String", required: false, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: 64, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "fast", typeName: "Bool", required: false, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "model", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: 256, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case agentKind = "agentKind"
    case contextSize = "contextSize"
    case effort = "effort"
    case fast = "fast"
    case model = "model"
  }
  public init(from decoder: Decoder) throws {
    let all = try decoder.container(keyedBy: RemoteCodingKey.self).allKeys.map(\.stringValue)
    let known = Set(Self.fields.map(\.wireName))
    guard all.allSatisfy(known.contains) else { throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown field in strict object")) }
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.agentKind = try container.decode(String.self, forKey: .agentKind)
    self.contextSize = try container.decode(RemoteField<String>.self, forKey: .contextSize)
    self.effort = try container.decode(RemoteField<String>.self, forKey: .effort)
    self.fast = try container.decode(RemoteField<Bool>.self, forKey: .fast)
    self.model = try container.decode(String.self, forKey: .model)
  }
  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(agentKind, forKey: .agentKind)
    try container.encode(contextSize, forKey: .contextSize)
    try container.encode(effort, forKey: .effort)
    try container.encode(fast, forKey: .fast)
    try container.encode(model, forKey: .model)
  }
}

public struct ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1U2DOptionU2D1U2DRolesU2DItem_63a5f0fcba: Codable, Sendable, RemoteModelMetadata {
  public var brief: RemoteField<String> = .missing
  public var fallbacks: RemoteField<[ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1U2DOptionU2D1U2DRolesU2DItemU2DFallbacksU2DItem_c33d76cdf9]> = .missing
  public var id: String
  public var label: String
  public var noEdits: RemoteField<ProcedurecloseCodeShareWorkspaceResultU2DClosed_d2dd3595e1> = .missing
  public var parallel: RemoteField<Int64> = .missing
  public var selection: ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1U2DOptionU2D1U2DRolesU2DItemU2DFallbacksU2DItem_c33d76cdf9
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .reject
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "brief", typeName: "String", required: false, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: 160, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "fallbacks", typeName: "[ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1U2DOptionU2D1U2DRolesU2DItemU2DFallbacksU2DItem_c33d76cdf9]", required: false, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: 3, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "id", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: "^[a-z0-9][a-z0-9-]{0,31}$", format: nil, semanticValidatorIds: []),
    .init(wireName: "label", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: 24, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "noEdits", typeName: "ProcedurecloseCodeShareWorkspaceResultU2DClosed_d2dd3595e1", required: false, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "parallel", typeName: "Int64", required: false, nullable: false, minimum: 1, maximum: 4, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "selection", typeName: "ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1U2DOptionU2D1U2DRolesU2DItemU2DFallbacksU2DItem_c33d76cdf9", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case brief = "brief"
    case fallbacks = "fallbacks"
    case id = "id"
    case label = "label"
    case noEdits = "noEdits"
    case parallel = "parallel"
    case selection = "selection"
  }
  public init(from decoder: Decoder) throws {
    let all = try decoder.container(keyedBy: RemoteCodingKey.self).allKeys.map(\.stringValue)
    let known = Set(Self.fields.map(\.wireName))
    guard all.allSatisfy(known.contains) else { throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown field in strict object")) }
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.brief = try container.decode(RemoteField<String>.self, forKey: .brief)
    self.fallbacks = try container.decode(RemoteField<[ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1U2DOptionU2D1U2DRolesU2DItemU2DFallbacksU2DItem_c33d76cdf9]>.self, forKey: .fallbacks)
    self.id = try container.decode(String.self, forKey: .id)
    self.label = try container.decode(String.self, forKey: .label)
    self.noEdits = try container.decode(RemoteField<ProcedurecloseCodeShareWorkspaceResultU2DClosed_d2dd3595e1>.self, forKey: .noEdits)
    self.parallel = try container.decode(RemoteField<Int64>.self, forKey: .parallel)
    self.selection = try container.decode(ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1U2DOptionU2D1U2DRolesU2DItemU2DFallbacksU2DItem_c33d76cdf9.self, forKey: .selection)
  }
  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(brief, forKey: .brief)
    try container.encode(fallbacks, forKey: .fallbacks)
    try container.encode(id, forKey: .id)
    try container.encode(label, forKey: .label)
    try container.encode(noEdits, forKey: .noEdits)
    try container.encode(parallel, forKey: .parallel)
    try container.encode(selection, forKey: .selection)
  }
}

public typealias ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1U2DOptionU2D1U2DVersion_7f9f5a0d72 = Double
