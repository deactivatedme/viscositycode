// GENERATED FILE. Do not edit by hand.
import Foundation
public extension RemoteSchemas {
  static let schema_a16cb9740d19657e = RemoteSchema(type: "array", maxItems: 8, items: RemoteSchemas.schema_d6a8cd432c4887c3, unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a1f40266b6e1acfa = RemoteSchema(type: "string", literals: [.string("prepare-worktree")], unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a20681cb358b7044 = RemoteSchema(type: "object", required: Set(["project", "pullRequestKeys", "refreshedAt"]), properties: ["project": RemoteSchemas.schema_83470ce63973b6e2, "pullRequestKeys": RemoteSchemas.schema_0f732b9fceb2c6ac, "refreshedAt": RemoteSchemas.schema_bf0b727f7b1c6d07, "viewerLogin": RemoteSchemas.schema_bf0b727f7b1c6d07], additionalAllowed: true, unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a26f77dd4ad13e5b = RemoteSchema(type: "object", required: Set(["targetPort"]), properties: ["targetPort": RemoteSchemas.schema_279eee1efa9da6c8], additionalAllowed: true, unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a2857498be68a6b2 = RemoteSchema(type: "object", required: Set(["projects", "runtimeSummariesByThread", "snapshotSeq", "threads", "updatedAt"]), properties: ["gitState": RemoteSchemas.schema_039d29a220abcf97, "gitSummariesByThread": RemoteSchemas.schema_aca97eda78815baa, "projects": RemoteSchemas.schema_71e40ca28c8b47ee, "projectsNextCursor": RemoteSchemas.schema_2d0b6ec9f2b2decf, "reads": RemoteSchemas.schema_4659e6d395f41e16, "runtimeSummariesByThread": RemoteSchemas.schema_fc9d6f4c2617a24d, "snapshotEpoch": RemoteSchemas.schema_8e43cad70cd70de7, "snapshotSeq": RemoteSchemas.schema_56aa0e45cbdce0d0, "threads": RemoteSchemas.schema_509b69ba008e0696, "threadsNextCursor": RemoteSchemas.schema_2d0b6ec9f2b2decf, "updatedAt": RemoteSchemas.schema_36fea325bf1aca70, "workspaces": RemoteSchemas.schema_15fcce03de60030d], additionalAllowed: true, unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a36830c34a81f248 = RemoteSchema(type: "object", required: Set(["kind"]), properties: ["kind": RemoteSchemas.schema_60fc988aefaed4f5], additionalAllowed: false, unknownPolicy: .reject)
}

public extension RemoteSchemas {
  static let schema_a399fbc7541223f3 = RemoteSchema(unionKind: "oneOf", options: [RemoteSchemas.schema_5ea95607826c2d23, RemoteSchemas.schema_12ca2594dca47145, RemoteSchemas.schema_43372628accc1dd8, RemoteSchemas.schema_0e036ef4dad9c975, RemoteSchemas.schema_849e43bfc063f1bb, RemoteSchemas.schema_501221cdcb9cd48b, RemoteSchemas.schema_1806ffb1da5fcacb], unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a39dd0410456fe31 = RemoteSchema(type: "object", required: Set(["balance"]), properties: ["balance": RemoteSchemas.schema_80c415b6e27c6ebd, "currency": RemoteSchemas.schema_bf0b727f7b1c6d07, "label": RemoteSchemas.schema_bf0b727f7b1c6d07, "unlimited": RemoteSchemas.schema_feeb8bb50144d96d], additionalAllowed: true, unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a3e9394f18b82504 = RemoteSchema(type: "string", literals: [.string("callTool")], unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a412a228f3b07cd3 = RemoteSchema(type: "object", required: Set(["details"]), properties: ["details": RemoteSchemas.schema_fb0686e874c29254, "pr": RemoteSchemas.schema_ea7fc856bb9aa12e], additionalAllowed: true, unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a44865d83be28e9f = RemoteSchema(unionKind: "anyOf", options: [RemoteSchemas.schema_36fea325bf1aca70, RemoteSchemas.schema_80c415b6e27c6ebd], unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a467b0ed1c0ea208 = RemoteSchema(type: "object", required: Set(["kind", "minute"]), properties: ["kind": RemoteSchemas.schema_6f5933af0336650b, "minute": RemoteSchemas.schema_53f3c1938556e280], additionalAllowed: true, unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a47dce098080dff5 = RemoteSchema(unionKind: "oneOf", options: [RemoteSchemas.schema_ced55d8893218e84, RemoteSchemas.schema_ac3c47c48ccf5bc6, RemoteSchemas.schema_37c5f2164832811e, RemoteSchemas.schema_174bab0c7c772746, RemoteSchemas.schema_134ccbcdbce97927, RemoteSchemas.schema_56d4279bb763b196, RemoteSchemas.schema_c215a52302a1f428], unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a563addb78b46707 = RemoteSchema(type: "object", required: Set(["changedFiles", "repoIdentities"]), properties: ["branch": RemoteSchemas.schema_36fea325bf1aca70, "changedFiles": RemoteSchemas.schema_56aa0e45cbdce0d0, "head": RemoteSchemas.schema_4e3a1013cf1d3a58, "repoIdentities": RemoteSchemas.schema_4db742376cbe66fa], additionalAllowed: true, unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a581e67cd137ad59 = RemoteSchema(type: "number", minimum: 0.0, maximum: 100.0, unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a59d7f7afd3350b1 = RemoteSchema(type: "object", required: Set(["id", "label"]), properties: ["description": RemoteSchemas.schema_36fea325bf1aca70, "id": RemoteSchemas.schema_36fea325bf1aca70, "label": RemoteSchemas.schema_36fea325bf1aca70, "tooltipDescription": RemoteSchemas.schema_36fea325bf1aca70], additionalAllowed: true, unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a5af9fa380f11a11 = RemoteSchema(type: "string", maxLength: 2048, unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a5b7c88e398574a5 = RemoteSchema(type: "string", literals: [.string("agent")], unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a627cf0d1237385c = RemoteSchema(type: "object", required: Set(["access", "path", "projectLocation"]), properties: ["access": RemoteSchemas.schema_2d29c7255e1cf1b1, "disposition": RemoteSchemas.schema_7db74ec55cf0af32, "path": RemoteSchemas.schema_bd85a52dd25effae, "projectLocation": RemoteSchemas.schema_080f9cc154af9e27], additionalAllowed: true, unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a633f9a256d1d0c9 = RemoteSchema(type: "object", required: Set(["reason", "seq", "type"]), properties: ["reason": RemoteSchemas.schema_36fea325bf1aca70, "seq": RemoteSchemas.schema_56aa0e45cbdce0d0, "space": RemoteSchemas.schema_22c1b4b934fdb197, "type": RemoteSchemas.schema_d9640543f6c97ed9], additionalAllowed: true, unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a66324f9a46c480b = RemoteSchema(type: "object", required: Set(["headers", "type", "url"]), properties: ["headers": RemoteSchemas.schema_c3ac2139868061bb, "type": RemoteSchemas.schema_3120d80990432c9a, "url": RemoteSchemas.schema_7ac95086b2ca282e], additionalAllowed: true, unknownPolicy: .strip, semanticIds: ["mcp.valid-url"])
}

public extension RemoteSchemas {
  static let schema_a663eabb01251186 = RemoteSchema(type: "object", required: Set(["executionHost", "kind", "retryAt"]), properties: ["executionHost": RemoteSchemas.schema_bf0b727f7b1c6d07, "kind": RemoteSchemas.schema_daefe10db0766411, "retryAt": RemoteSchemas.schema_bf0b727f7b1c6d07], additionalAllowed: true, unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a6940e107dbdb450 = RemoteSchema(type: "object", required: Set(["fwt"]), properties: ["fwt": RemoteSchemas.schema_bf0b727f7b1c6d07], additionalAllowed: true, unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a6ba34cd39bf30c5 = RemoteSchema(type: "boolean", defaultValue: .bool(true), unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a6c274420d82c814 = RemoteSchema(type: "array", maxItems: 2, items: RemoteSchemas.schema_97a2308a409b73af, unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a6f98c7f485db267 = RemoteSchema(type: "object", required: Set(["projectLocation", "worktreePaths"]), properties: ["detail": RemoteSchemas.schema_15cae388d0cdd5b6, "projectLocation": RemoteSchemas.schema_080f9cc154af9e27, "worktreePaths": RemoteSchemas.schema_515482d2104d1efa], additionalAllowed: true, unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a76106fec07f8e2b = RemoteSchema(type: "string", literals: [.string("read"), .string("appearance"), .string("textSize"), .string("orientation"), .string("reduceMotion"), .string("network"), .string("location"), .string("permission"), .string("openUrl"), .string("launchApp"), .string("powerOff")], unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a77c8545896b4c52 = RemoteSchema(type: "string", literals: [.string("move")], unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a799b0e11ed8f6df = RemoteSchema(type: "string", literals: [.string("usage.spent")], unknownPolicy: .strip)
}

public extension RemoteSchemas {
  static let schema_a7a81bdaababd798 = RemoteSchema(type: "object", required: Set(["ok"]), properties: ["created": RemoteSchemas.schema_feeb8bb50144d96d, "ok": RemoteSchemas.schema_d2dd3595e1b5e5dc, "project": RemoteSchemas.schema_295340fa71894405], additionalAllowed: true, unknownPolicy: .strip)
}
