import "@jigging/flow-authoring/typespec";
using FLOW;

@invocation(Input, Result, #{
  id: "https://example.org/methods/review",
  version: "1.0.0",
  channels: #{
    progress: #{direction: "send", contract: "./progress.channel.json", required: false}
  }
})
namespace Review;

@closed model Input { source: string; }
@closed model Result { outcome: "done"; output: string; }

@channelContract("./progress.channel.json", #{
  id: "https://example.org/channels/review-progress",
  version: "1.0.0",
  semantics: "Selected review progress. End of messages does not establish review success."
})
@closed model Progress {
  phase: "reading" | "checking";
  @maxLength(256) message: string;
}
