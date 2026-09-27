CREATE TABLE "src_story_data" (
	"storyId" integer PRIMARY KEY NOT NULL,
	"bundle" jsonb NOT NULL,
	"importedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "src_story_data" ADD CONSTRAINT "src_story_data_storyId_src_story_id_fk" FOREIGN KEY ("storyId") REFERENCES "public"."src_story"("id") ON DELETE cascade ON UPDATE no action;