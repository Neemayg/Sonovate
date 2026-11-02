
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "context_readings": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"owner_id": string,"recording_id": string,"source": string,"unit": string,"value": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"owner_id"?: string,"recording_id": string,"source"?: string,"unit": string,"value": number
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"owner_id"?: string,"recording_id"?: string,"source"?: string,"unit"?: string,"value"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "context_readings_recording_id_owner_id_fkey"
      columns: ["recording_id","owner_id"]
isOneToOne: false
      referencedRelation: "recordings"
      referencedColumns: ["id","owner_id"]
    }
                  ]
                },"machines": {
                  Row: {
                    "created_at": string,"id": string,"location": string | null,"machine_type": Database["public"]['Enums']["machine_type"],"name": string,"notes": string | null,"owner_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"location"?: string | null,"machine_type"?: Database["public"]['Enums']["machine_type"],"name": string,"notes"?: string | null,"owner_id"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"location"?: string | null,"machine_type"?: Database["public"]['Enums']["machine_type"],"name"?: string,"notes"?: string | null,"owner_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "machines_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"model_versions": {
                  Row: {
                    "created_at": string,"evidence_ref": string,"id": string,"name": string,"preprocessing_version": string,"version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"evidence_ref": string,"id"?: string,"name": string,"preprocessing_version": string,"version": string
                  }
                  Update: {
                    "created_at"?: string,"evidence_ref"?: string,"id"?: string,"name"?: string,"preprocessing_version"?: string,"version"?: string
                  }
                  Relationships: [
                    
                  ]
                },"predictions": {
                  Row: {
                    "created_at": string,"decision": string,"id": string,"model_version_id": string,"owner_id": string,"recording_id": string,"score": number,"threshold": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"decision": string,"id"?: string,"model_version_id": string,"owner_id": string,"recording_id": string,"score": number,"threshold": number
                  }
                  Update: {
                    "created_at"?: string,"decision"?: string,"id"?: string,"model_version_id"?: string,"owner_id"?: string,"recording_id"?: string,"score"?: number,"threshold"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "predictions_model_version_id_fkey"
      columns: ["model_version_id"]
isOneToOne: false
      referencedRelation: "model_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "predictions_recording_id_owner_id_fkey"
      columns: ["recording_id","owner_id"]
isOneToOne: false
      referencedRelation: "recordings"
      referencedColumns: ["id","owner_id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"display_name": string | null,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name"?: string | null,"id": string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string | null,"id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"recordings": {
                  Row: {
                    "channels": number | null,"created_at": string,"duration_seconds": number | null,"id": string,"kind": Database["public"]['Enums']["recording_kind"],"machine_id": string,"original_filename": string | null,"owner_id": string,"recorded_at": string | null,"sample_rate_hz": number | null,"size_bytes": number | null,"storage_path": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channels"?: number | null,"created_at"?: string,"duration_seconds"?: number | null,"id"?: string,"kind"?: Database["public"]['Enums']["recording_kind"],"machine_id": string,"original_filename"?: string | null,"owner_id"?: string,"recorded_at"?: string | null,"sample_rate_hz"?: number | null,"size_bytes"?: number | null,"storage_path": string
                  }
                  Update: {
                    "channels"?: number | null,"created_at"?: string,"duration_seconds"?: number | null,"id"?: string,"kind"?: Database["public"]['Enums']["recording_kind"],"machine_id"?: string,"original_filename"?: string | null,"owner_id"?: string,"recorded_at"?: string | null,"sample_rate_hz"?: number | null,"size_bytes"?: number | null,"storage_path"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "recordings_machine_id_owner_id_fkey"
      columns: ["machine_id","owner_id"]
isOneToOne: false
      referencedRelation: "machines"
      referencedColumns: ["id","owner_id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            [_ in never]: never
          }
          Enums: {
            "machine_type": "bearing"|"gearbox"|"other","recording_kind": "baseline"|"analysis"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "machine_type": ["bearing", "gearbox", "other"],"recording_kind": ["baseline", "analysis"]
          }
        }
} as const
