/**
 * An example `Package.resolved` for trying the tool without a checkout.
 *
 * Repository names and versions are real bhashacode packages and real tags, so
 * the internal/external split demonstrates something true. The revisions are
 * placeholders — they are not real commit SHAs, and the tool will say so by
 * failing to read a manifest at them rather than pretending otherwise.
 */
export const SAMPLE_RESOLVED = `{
  "originHash" : "example-not-a-real-hash",
  "pins" : [
    {
      "identity" : "alamofire",
      "kind" : "remoteSourceControl",
      "location" : "https://github.com/Alamofire/Alamofire.git",
      "state" : {
        "revision" : "0000000000000000000000000000000000000001",
        "version" : "5.10.2"
      }
    },
    {
      "identity" : "cocoamqtt",
      "kind" : "remoteSourceControl",
      "location" : "https://github.com/emqx/CocoaMQTT.git",
      "state" : {
        "revision" : "0000000000000000000000000000000000000002",
        "version" : "2.1.6"
      }
    },
    {
      "identity" : "swift-log",
      "kind" : "remoteSourceControl",
      "location" : "https://github.com/apple/swift-log.git",
      "state" : {
        "revision" : "0000000000000000000000000000000000000003",
        "version" : "1.6.4"
      }
    },
    {
      "identity" : "swift-spm-bhasha-callkit-core",
      "kind" : "remoteSourceControl",
      "location" : "https://github.com/bhashacode/swift-spm-bhasha-callkit-core.git",
      "state" : {
        "revision" : "0000000000000000000000000000000000000004",
        "version" : "2.2.0"
      }
    },
    {
      "identity" : "swift-spm-bhasha-callkit-ui",
      "kind" : "remoteSourceControl",
      "location" : "git@github.com:bhashacode/swift-spm-bhasha-callkit-ui.git",
      "state" : {
        "revision" : "0000000000000000000000000000000000000005",
        "version" : "1.0.8"
      }
    },
    {
      "identity" : "swift-spm-bhasha-connectivity",
      "kind" : "remoteSourceControl",
      "location" : "https://github.com/bhashacode/swift-spm-bhasha-connectivity.git",
      "state" : {
        "revision" : "0000000000000000000000000000000000000006",
        "version" : "1.4.0"
      }
    },
    {
      "identity" : "swift-spm-bhasha-mobilelogkit",
      "kind" : "remoteSourceControl",
      "location" : "https://github.com/bhashacode/swift-spm-bhasha-mobilelogkit",
      "state" : {
        "branch" : "main",
        "revision" : "0000000000000000000000000000000000000007"
      }
    },
    {
      "identity" : "swift-spm-helago-contracts",
      "kind" : "remoteSourceControl",
      "location" : "https://github.com/bhashacode/swift-spm-helago-contracts.git",
      "state" : {
        "revision" : "0000000000000000000000000000000000000008",
        "version" : "1.2.7"
      }
    },
    {
      "identity" : "swift-spm-token-manager",
      "kind" : "remoteSourceControl",
      "location" : "https://github.com/bhashacode/swift-spm-token-manager.git",
      "state" : {
        "revision" : "0000000000000000000000000000000000000009"
      }
    },
    {
      "identity" : "swift-spm-webrtckit-core",
      "kind" : "remoteSourceControl",
      "location" : "https://github.com/BhashaCode/swift-spm-webrtckit-core.git",
      "state" : {
        "revision" : "000000000000000000000000000000000000000a",
        "version" : "1.0.7"
      }
    }
  ],
  "version" : 3
}
`
