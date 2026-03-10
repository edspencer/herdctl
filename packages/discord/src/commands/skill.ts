import type { AutocompleteInteraction, SlashCommandBuilder } from "discord.js";
import type { CommandContext, SlashCommand } from "./types.js";

function buildSkillCommand(builder: SlashCommandBuilder): SlashCommandBuilder {
  builder.addStringOption((option) =>
    option.setName("name").setDescription("Skill name").setRequired(true).setAutocomplete(true),
  );
  builder.addStringOption((option) =>
    option.setName("input").setDescription("Optional input for the skill").setRequired(false),
  );
  return builder;
}

async function autocompleteSkill(
  interaction: AutocompleteInteraction,
  context: Omit<CommandContext, "interaction">,
): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase();
  const skills = context.commandActions?.listSkills
    ? await context.commandActions.listSkills()
    : [];
  const choices = skills
    .filter((skill) => skill.name.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((skill) => ({
      name: skill.description ? `${skill.name} — ${skill.description}`.slice(0, 100) : skill.name,
      value: skill.name,
    }));
  await interaction.respond(choices);
}

export const skillCommand: SlashCommand = {
  name: "skill",
  description: "Trigger a skill in this channel",
  build: buildSkillCommand,
  autocomplete: autocompleteSkill,

  async execute(context: CommandContext): Promise<void> {
    const { interaction, commandActions, agentName } = context;
    const skillName = interaction.options.getString("name", true);
    const input = interaction.options.getString("input", false) ?? undefined;
    const result = commandActions?.runSkill
      ? await commandActions.runSkill(interaction.channelId, skillName, input)
      : { success: false, message: "Skill execution is not available in this deployment." };

    await interaction.reply({
      embeds: [
        {
          description: result.message,
          color: result.success ? 0x22c55e : 0xef4444,
          footer: { text: `herdctl · ${agentName}` },
        },
      ],
      ephemeral: true,
    });
  },
};
