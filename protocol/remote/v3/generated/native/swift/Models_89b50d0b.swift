// GENERATED FILE. Do not edit by hand.
import Foundation
public enum ProcedureexecuteCodeShareFileToolRequestU2DToolU2DOptionU2D3U2DName_9dd9cb5788: String, Codable, Sendable {
  case `writeU5FFile` = "write_file"
}

public struct ProcedureexecuteCodeShareFileToolRequestU2DToolU2DOptionU2D3_02b179207e: Codable, Sendable, RemoteModelMetadata {
  public var content: String
  public var expectedModifiedAtMs: Double
  public var name: ProcedureexecuteCodeShareFileToolRequestU2DToolU2DOptionU2D3U2DName_9dd9cb5788
  public var path: String
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .reject
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "content", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: 128000, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "expectedModifiedAtMs", typeName: "Double", required: true, nullable: false, minimum: 0, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "name", typeName: "ProcedureexecuteCodeShareFileToolRequestU2DToolU2DOptionU2D3U2DName_9dd9cb5788", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "path", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: 1024, minItems: nil, maxItems: nil, pattern: "^(?!\\.{1,2}(?:\\/|$))(?!.*\\/\\.{1,2}(?:\\/|$))[^/\\\\:\\p{Cc}]+(?:\\/[^/\\\\:\\p{Cc}]+)*$", format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case content = "content"
    case expectedModifiedAtMs = "expectedModifiedAtMs"
    case name = "name"
    case path = "path"
  }
  public init(from decoder: Decoder) throws {
    let all = try decoder.container(keyedBy: RemoteCodingKey.self).allKeys.map(\.stringValue)
    let known = Set(Self.fields.map(\.wireName))
    guard all.allSatisfy(known.contains) else { throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown field in strict object")) }
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.content = try container.decode(String.self, forKey: .content)
    self.expectedModifiedAtMs = try container.decode(Double.self, forKey: .expectedModifiedAtMs)
    self.name = try container.decode(ProcedureexecuteCodeShareFileToolRequestU2DToolU2DOptionU2D3U2DName_9dd9cb5788.self, forKey: .name)
    self.path = try container.decode(String.self, forKey: .path)
  }
  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(content, forKey: .content)
    try container.encode(expectedModifiedAtMs, forKey: .expectedModifiedAtMs)
    try container.encode(name, forKey: .name)
    try container.encode(path, forKey: .path)
  }
}

public enum ProcedureexecuteCodeShareFileToolRequestU2DToolU2DOptionU2D4U2DName_0b1635c919: String, Codable, Sendable {
  case `createU5FFile` = "create_file"
}

public struct ProcedureexecuteCodeShareFileToolRequestU2DToolU2DOptionU2D4_ebe1a88408: Codable, Sendable, RemoteModelMetadata {
  public var content: String
  public var name: ProcedureexecuteCodeShareFileToolRequestU2DToolU2DOptionU2D4U2DName_0b1635c919
  public var path: String
  public static let unknownFieldPolicy: RemoteUnknownFieldPolicy = .reject
  public static let fields: [RemoteFieldDescriptor] = [
    .init(wireName: "content", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: 128000, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "name", typeName: "ProcedureexecuteCodeShareFileToolRequestU2DToolU2DOptionU2D4U2DName_0b1635c919", required: true, nullable: false, minimum: nil, maximum: nil, minLength: nil, maxLength: nil, minItems: nil, maxItems: nil, pattern: nil, format: nil, semanticValidatorIds: []),
    .init(wireName: "path", typeName: "String", required: true, nullable: false, minimum: nil, maximum: nil, minLength: 1, maxLength: 1024, minItems: nil, maxItems: nil, pattern: "^(?!\\.{1,2}(?:\\/|$))(?!.*\\/\\.{1,2}(?:\\/|$))[^/\\\\:\\p{Cc}]+(?:\\/[^/\\\\:\\p{Cc}]+)*$", format: nil, semanticValidatorIds: []),
  ]
  public static let semanticValidatorIds: [String] = []
  private enum CodingKeys: String, CodingKey {
    case content = "content"
    case name = "name"
    case path = "path"
  }
  public init(from decoder: Decoder) throws {
    let all = try decoder.container(keyedBy: RemoteCodingKey.self).allKeys.map(\.stringValue)
    let known = Set(Self.fields.map(\.wireName))
    guard all.allSatisfy(known.contains) else { throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown field in strict object")) }
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.content = try container.decode(String.self, forKey: .content)
    self.name = try container.decode(ProcedureexecuteCodeShareFileToolRequestU2DToolU2DOptionU2D4U2DName_0b1635c919.self, forKey: .name)
    self.path = try container.decode(String.self, forKey: .path)
  }
  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(content, forKey: .content)
    try container.encode(name, forKey: .name)
    try container.encode(path, forKey: .path)
  }
}
