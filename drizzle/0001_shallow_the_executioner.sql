CREATE TABLE "task_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"google_task_id" text NOT NULL,
	"google_task_list_id" text NOT NULL,
	"due_at" timestamp with time zone,
	"color_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_metadata_user_id_google_task_id_google_task_list_id_unique" UNIQUE("user_id","google_task_id","google_task_list_id")
);
--> statement-breakpoint
ALTER TABLE "task_metadata" ADD CONSTRAINT "task_metadata_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;