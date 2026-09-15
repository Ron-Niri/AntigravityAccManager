const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

// Read schema data, never evaluate the IDE's bundled application code.
function loadCodec(appRoot) {
  const requireIde = createRequire(path.join(appRoot, 'package.json'));
  const pb = requireIde('@bufbuild/protobuf');
  const { fileDesc } = requireIde('@bufbuild/protobuf/codegenv2');
  const { FileDescriptorProtoSchema } = requireIde('@bufbuild/protobuf/wkt');
  const source = fs.readFileSync(path.join(appRoot, 'out/main.js'), 'utf8');
  const definitions = new Map(), files = new Map();
  const wellKnown = Object.values(requireIde('@bufbuild/protobuf/wkt')).filter(v => v?.kind === 'file');
  for (const match of source.matchAll(/([\w$]+)=[\w$]+\(\{name:"(google\/protobuf\/[^" ]+\.proto)"/g)) {
    const file = wellKnown.find(f => f.proto.name === match[2]);
    if (file) files.set(match[1], file);
  }
  for (const match of source.matchAll(/([\w$]+)=[\w$]+\("([A-Za-z0-9+/=]{100,})"(?:,\[([\w$,]*)\])?\)/g)) {
    try {
      const proto = pb.fromBinary(FileDescriptorProtoSchema, Buffer.from(match[2], 'base64'));
      if (proto.name.endsWith('.proto')) definitions.set(match[1], { data: match[2], proto, deps: match[3]?.split(',').filter(Boolean) || [] });
    } catch { /* Not a descriptor. */ }
  }
  function resolve(id) {
    if (files.has(id)) return files.get(id);
    const def = definitions.get(id);
    if (!def) throw new Error(`Installed IDE schema dependency ${id} is unavailable.`);
    const file = fileDesc(def.data, def.deps.map(resolve)); files.set(id, file); return file;
  }
  const entry = [...definitions].find(([, d]) => d.proto.messageType.some(m => m.name === 'UserStatus'));
  if (!entry) throw new Error('Installed IDE UserStatus schema was not found.');
  const file = resolve(entry[0]);
  const schema = file.messages.find(m => m.name === 'UserStatus');
  return {
    schema,
    encode(json) { return Buffer.from(pb.toBinary(schema, pb.fromJson(schema, JSON.parse(JSON.stringify(json)), { ignoreUnknownFields: true }))).toString('base64'); },
    decode(value) { return pb.toJson(schema, pb.fromBinary(schema, Buffer.from(value, 'base64'))); }
  };
}

function userStatusJson(catalog, settings, identity, tier) {
  const models = catalog.models;
  const ids = [...new Set((catalog.agentModelSorts || []).flatMap(s => s.groups.flatMap(g => g.modelIds)).filter(id => models[id]))];
  const clientModelConfigs = ids.map(id => {
    const m = models[id];
    return { label: m.displayName, modelOrAlias: { model: m.model }, disabled: m.disabled,
      supportsImages: m.supportsImages, supportedMimeTypes: m.supportedMimeTypes, isBeta: m.beta,
      betaWarningMessage: m.betaWarningMessage, tagTitle: m.tagTitle, tagDescription: m.tagDescription,
      isRecommended: m.recommended, description: m.description, quotaInfo: m.quotaInfo };
  });
  return { name: identity.name, email: identity.email, profilePictureUrl: identity.picture || '',
    disableTelemetry: !settings.telemetryEnabled, userDataCollectionForceDisabled: !!settings.userDataCollectionForceDisabled,
    userTier: tier,
    cascadeModelConfigData: {
      clientModelConfigs,
      clientModelSorts: (catalog.agentModelSorts || []).map(s => ({ name: s.displayName,
        groups: s.groups.map(g => ({ groupName: g.displayName, modelLabels: g.modelIds.filter(id => models[id]).map(id => models[id].displayName) })) })),
      ...(models[catalog.defaultAgentModelId] ? { defaultOverrideModelConfig: { modelOrAlias: { model: models[catalog.defaultAgentModelId].model } } } : {})
    }
  };
}

async function pushStatus(api, value) {
  await api.pushUpdate({ topicName: 'uss-userStatus', appliedUpdate: {
    key: 'userStatusSentinelKey', newRow: { value, eTag: '0' }
  } });
}
module.exports = { loadCodec, userStatusJson, pushStatus };
