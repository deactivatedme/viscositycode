// GENERATED FILE. Do not edit by hand.
import Foundation
public struct ProcedureconnectThreadVoiceRequest_898057a01b: Codable, Sendable, RemoteModelMetadata {
  public var config: ProcedureconnectThreadVoiceRequestU2DConfig_3630df9ed3
  public var connectionId: String
  public var offerSdp: String
  public var threadId: String
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "config", typeName: "ProcedureconnectThreadVoiceRequestU2DConfig_3630df9ed3", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "connectionId", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$", format: "uuid", semanticValidatorIds: []),
    .init(wireName: "offerSdp", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: 64000, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "threadId", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case config = "config"
    case connectionId = "connectionId"
    case offerSdp = "offerSdp"
    case threadId = "threadId"
  }
}

public struct ProcedureconnectThreadVoiceResult_871fe12f7d: Codable, Sendable, RemoteModelMetadata {
  public var answerSdp: ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "answerSdp", typeName: "ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case answerSdp = "answerSdp"
  }
}

public enum ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D1U2DType_b796dbfba5: String, Codable, Sendable {
  case `readResource` = "readResource"
}

public struct ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D1_74839ee2e9: Codable, Sendable, RemoteModelMetadata {
  public var typeValue: ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D1U2DType_b796dbfba5
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "type", typeName: "ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D1U2DType_b796dbfba5", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case typeValue = "type"
  }
}

public enum ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D2U2DType_53dc1dce3c: String, Codable, Sendable {
  case `listTools` = "listTools"
}

public struct ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D2_bf04d82b24: Codable, Sendable, RemoteModelMetadata {
  public var typeValue: ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D2U2DType_53dc1dce3c
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "type", typeName: "ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D2U2DType_53dc1dce3c", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case typeValue = "type"
  }
}

public typealias ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D3U2DArguments_e6958017da = [String: RemoteJSONValue]

public enum ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D3U2DType_a3e9394f18: String, Codable, Sendable {
  case `callTool` = "callTool"
}

public struct ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D3_865a18dcd9: Codable, Sendable, RemoteModelMetadata {
  public var arguments: RemoteField<ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D3U2DArguments_e6958017da> = .missing
  public var name: String
  public var typeValue: ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D3U2DType_a3e9394f18
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "arguments", typeName: "ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D3U2DArguments_e6958017da", required: false, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "name", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: 256, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "type", typeName: "ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D3U2DType_a3e9394f18", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case arguments = "arguments"
    case name = "name"
    case typeValue = "type"
  }
}

public enum ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D4U2DContentU2DItemU2DType_3ad514880d: String, Codable, Sendable {
  case `text` = "text"
}

public struct ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D4U2DContentU2DItem_0bb586e07b: Codable, Sendable, RemoteModelMetadata {
  public var text: String
  public var typeValue: ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D4U2DContentU2DItemU2DType_3ad514880d
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "text", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: 65536, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "type", typeName: "ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D4U2DContentU2DItemU2DType_3ad514880d", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case text = "text"
    case typeValue = "type"
  }
}

public enum ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D4U2DType_7611350a61: String, Codable, Sendable {
  case `updateModelContext` = "updateModelContext"
}

public struct ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D4_48946bc0ed: Codable, Sendable, RemoteModelMetadata {
  public var content: RemoteField<[ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D4U2DContentU2DItem_0bb586e07b]> = .missing
  public var structuredContent: RemoteField<ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D3U2DArguments_e6958017da> = .missing
  public var typeValue: ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D4U2DType_7611350a61
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "content", typeName: "[ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D4U2DContentU2DItem_0bb586e07b]", required: false, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: 32, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "structuredContent", typeName: "ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D3U2DArguments_e6958017da", required: false, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "type", typeName: "ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D4U2DType_7611350a61", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case content = "content"
    case structuredContent = "structuredContent"
    case typeValue = "type"
  }
}

public enum ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D5U2DType_482c928271: String, Codable, Sendable {
  case `cancel` = "cancel"
}

public struct ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D5_59d16cc54d: Codable, Sendable, RemoteModelMetadata {
  public var typeValue: ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D5U2DType_482c928271
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "type", typeName: "ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D5U2DType_482c928271", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case typeValue = "type"
  }
}

public enum ProcedurecontrolMcpAppRequestU2DAction_8c2d417de5: Codable, Sendable {
  case option1(ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D1_74839ee2e9)
  case option2(ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D2_bf04d82b24)
  case option3(ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D3_865a18dcd9)
  case option4(ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D4_48946bc0ed)
  case option5(ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D5_59d16cc54d)
  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    var matches: [(Int, ProcedurecontrolMcpAppRequestU2DAction_8c2d417de5)] = []
    if RemoteUnionProbe.matchesProperty(decoder, property: "type", literals: [.string("readResource")]), let value = try? container.decode(ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D1_74839ee2e9.self) {
      matches.append((1, .option1(value)))
    }
    if RemoteUnionProbe.matchesProperty(decoder, property: "type", literals: [.string("listTools")]), let value = try? container.decode(ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D2_bf04d82b24.self) {
      matches.append((2, .option2(value)))
    }
    if RemoteUnionProbe.matchesProperty(decoder, property: "type", literals: [.string("callTool")]), let value = try? container.decode(ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D3_865a18dcd9.self) {
      matches.append((3, .option3(value)))
    }
    if RemoteUnionProbe.matchesProperty(decoder, property: "type", literals: [.string("updateModelContext")]), let value = try? container.decode(ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D4_48946bc0ed.self) {
      matches.append((4, .option4(value)))
    }
    if RemoteUnionProbe.matchesProperty(decoder, property: "type", literals: [.string("cancel")]), let value = try? container.decode(ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D5_59d16cc54d.self) {
      matches.append((5, .option5(value)))
    }
    guard matches.count == 1 else {
      let detail = matches.isEmpty ? "No union option matched ProcedurecontrolMcpAppRequestU2DAction_8c2d417de5" : "Ambiguous union ProcedurecontrolMcpAppRequestU2DAction_8c2d417de5 matched options " + matches.map { String($0.0) }.joined(separator: ", ")
      throw DecodingError.typeMismatch(ProcedurecontrolMcpAppRequestU2DAction_8c2d417de5.self, .init(codingPath: decoder.codingPath, debugDescription: detail))
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
    }
  }
}

public struct ProcedurecontrolMcpAppRequestU2DApp_b313ad72a5: Codable, Sendable, RemoteModelMetadata {
  public var resourceUri: String
  public var sessionId: String
  public var toolName: String
  public var version: ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1U2DOptionU2D1U2DVersion_7f9f5a0d72
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "resourceUri", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: 4096, minItems: nil, maxItems: nil, pattern: "^ui:\\/\\/.*", format: nil, semanticValidatorIds: []),
    .init(wireName: "sessionId", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$", format: "uuid", semanticValidatorIds: []),
    .init(wireName: "toolName", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: 256, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "version", typeName: "ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1U2DOptionU2D1U2DVersion_7f9f5a0d72", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case resourceUri = "resourceUri"
    case sessionId = "sessionId"
    case toolName = "toolName"
    case version = "version"
  }
}

public struct ProcedurecontrolMcpAppRequest_339dd50c84: Codable, Sendable, RemoteModelMetadata {
  public var action: ProcedurecontrolMcpAppRequestU2DAction_8c2d417de5
  public var app: ProcedurecontrolMcpAppRequestU2DApp_b313ad72a5
  public var requestId: String
  public var threadId: String
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "action", typeName: "ProcedurecontrolMcpAppRequestU2DAction_8c2d417de5", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "app", typeName: "ProcedurecontrolMcpAppRequestU2DApp_b313ad72a5", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "requestId", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$", format: "uuid", semanticValidatorIds: []),
    .init(wireName: "threadId", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case action = "action"
    case app = "app"
    case requestId = "requestId"
    case threadId = "threadId"
  }
}

public struct ProcedurecontrolMcpAppResult_054db97313: Codable, Sendable, RemoteModelMetadata {
  public var result: ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D3U2DArguments_e6958017da
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "result", typeName: "ProcedurecontrolMcpAppRequestU2DActionU2DOptionU2D3U2DArguments_e6958017da", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case result = "result"
  }
}

public struct ProcedurecreateFileCheckpointRequest_412fb1bbf4: Codable, Sendable, RemoteModelMetadata {
  public var checkpointItemId: String
  public var projectLocation: ProcedurebeginMcpServerOauthRequestU2DProjectLocation_080f9cc154
  public var threadId: String
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "checkpointItemId", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "projectLocation", typeName: "ProcedurebeginMcpServerOauthRequestU2DProjectLocation_080f9cc154", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "threadId", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case checkpointItemId = "checkpointItemId"
    case projectLocation = "projectLocation"
    case threadId = "threadId"
  }
}

public struct ProcedurecreateFileCheckpointResultU2DCheckpoint_938414fbfa: Codable, Sendable, RemoteModelMetadata {
  public var capturedAt: String
  public var checkpointItemId: String
  public var commit: String
  public var ref: String
  public var threadId: String
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "capturedAt", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "checkpointItemId", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "commit", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "ref", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "threadId", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case capturedAt = "capturedAt"
    case checkpointItemId = "checkpointItemId"
    case commit = "commit"
    case ref = "ref"
    case threadId = "threadId"
  }
}

public struct ProcedurecreateFileCheckpointResult_012b6b31ad: Codable, Sendable, RemoteModelMetadata {
  public var checkpoint: ProcedurecreateFileCheckpointResultU2DCheckpoint_938414fbfa
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "checkpoint", typeName: "ProcedurecreateFileCheckpointResultU2DCheckpoint_938414fbfa", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case checkpoint = "checkpoint"
  }
}

public struct ProcedurecreateProjectEntryRequest_5027b509e8: Codable, Sendable, RemoteModelMetadata {
  public var path: String
  public var projectLocation: ProcedurebeginMcpServerOauthRequestU2DProjectLocation_080f9cc154
  public var typeValue: ProcedurebrowseHostDirectoryResultU2DEntriesU2DItemU2DType_8d3732b59a
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "path", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "projectLocation", typeName: "ProcedurebeginMcpServerOauthRequestU2DProjectLocation_080f9cc154", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "type", typeName: "ProcedurebrowseHostDirectoryResultU2DEntriesU2DItemU2DType_8d3732b59a", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case path = "path"
    case projectLocation = "projectLocation"
    case typeValue = "type"
  }
}

public struct ProcedurecreateRevertAnchorRequest_0774629ce7: Codable, Sendable, RemoteModelMetadata {
  public var config: RemoteField<ProcedureconnectThreadVoiceRequestU2DConfig_3630df9ed3> = .missing
  public var numTurns: Int64
  public var threadId: String
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "config", typeName: "ProcedureconnectThreadVoiceRequestU2DConfig_3630df9ed3", required: false, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "numTurns", typeName: "Int64", required: true, nullable: false, minimum: 1, maximum: 9007199254740991, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "threadId", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case config = "config"
    case numTurns = "numTurns"
    case threadId = "threadId"
  }
}

public struct ProcedurecreateRevertAnchorResultU2DAnchor_98ef330d70: Codable, Sendable, RemoteModelMetadata {
  public var data: RemoteJSONValue
  public var version: ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1U2DOptionU2D1U2DVersion_7f9f5a0d72
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "data", typeName: "RemoteJSONValue", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "version", typeName: "ProcedureconnectThreadVoiceRequestU2DConfigU2DCrewU2DOptionU2D1U2DOptionU2D1U2DVersion_7f9f5a0d72", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case data = "data"
    case version = "version"
  }
}

public struct ProcedurecreateRevertAnchorResult_8d15f7f900: Codable, Sendable, RemoteModelMetadata {
  public var anchor: ProcedurecreateRevertAnchorResultU2DAnchor_98ef330d70
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "anchor", typeName: "ProcedurecreateRevertAnchorResultU2DAnchor_98ef330d70", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case anchor = "anchor"
  }
}

public struct ProceduredeleteProjectEntryRequest_56df8e6416: Codable, Sendable, RemoteModelMetadata {
  public var path: String
  public var projectLocation: ProcedurebeginMcpServerOauthRequestU2DProjectLocation_080f9cc154
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "path", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "projectLocation", typeName: "ProcedurebeginMcpServerOauthRequestU2DProjectLocation_080f9cc154", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case path = "path"
    case projectLocation = "projectLocation"
  }
}

public struct ProceduredeleteSkillRequest_3df4f14bf2: Codable, Sendable, RemoteModelMetadata {
  public var absolutePath: String
  public var projectLocation: RemoteField<ProcedurebeginMcpServerOauthRequestU2DProjectLocation_080f9cc154> = .missing
  public var wslDistro: RemoteField<String> = .missing
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "absolutePath", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "projectLocation", typeName: "ProcedurebeginMcpServerOauthRequestU2DProjectLocation_080f9cc154", required: false, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "wslDistro", typeName: "String", required: false, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case absolutePath = "absolutePath"
    case projectLocation = "projectLocation"
    case wslDistro = "wslDistro"
  }
}

public struct ProceduredetectSetupScriptRequest_5e3a19fb85: Codable, Sendable, RemoteModelMetadata {
  public var projectLocation: ProcedurebeginMcpServerOauthRequestU2DProjectLocation_080f9cc154
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "projectLocation", typeName: "ProcedurebeginMcpServerOauthRequestU2DProjectLocation_080f9cc154", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case projectLocation = "projectLocation"
  }
}

public struct ProceduredetectSetupScriptResult_18b29df576: Codable, Sendable, RemoteModelMetadata {
  public var setupScript: RemoteField<ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b> = .missing
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "setupScript", typeName: "ProcedurebeginMcpServerOauthRequestU2DServerU2DTransportU2DOptionU2D1U2DArgsU2DItem_bf0b727f7b", required: false, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case setupScript = "setupScript"
  }
}

public struct ProceduredisconnectThreadVoiceRequest_2a150cae99: Codable, Sendable, RemoteModelMetadata {
  public var connectionId: String
  public var threadId: String
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .strip
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "connectionId", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$", format: "uuid", semanticValidatorIds: []),
    .init(wireName: "threadId", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case connectionId = "connectionId"
    case threadId = "threadId"
  }
}

public enum ProcedurediscoverExternalMcpServersRequestU2DOptionU2D1U2DSourceScope_6a2600edfb: String, Codable, Sendable {
  case `user` = "user"
}
